<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Invoicing\HybridInvoice;
use Cockpit\Invoicing\Invoice;
use Cockpit\Invoicing\InvoiceLine;
use Cockpit\Invoicing\InvoicePdf;
use Cockpit\Invoicing\Party;
use Cockpit\Invoicing\Samples;
use Cockpit\Invoicing\ZugferdXml;
use DateTimeImmutable;
use DOMDocument;
use DOMXPath;
use horstoeko\zugferd\ZugferdDocumentReader;
use horstoeko\zugferd\ZugferdXsdValidator;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class InvoicingTest extends TestCase
{
    public function testComputesLineAndTotalAmountsInCents(): void
    {
        $line = new InvoiceLine('Schulung', 1500, 'HUR', 8000);
        self::assertSame(12000, $line->netCents());
        self::assertSame(500, (new InvoiceLine('x', 1500, 'C62', 333))->netCents(), '1.5 × 3.33 € = 4.995 € rounds half up to 5.00 €.');
        $discounted = new InvoiceLine('Fachbuch', 2000, 'C62', 2490, 7, discountBp: 1000);
        self::assertSame(4980, $discounted->amountBeforeDiscountCents());
        self::assertSame(498, $discounted->discountCents());
        self::assertSame(4482, $discounted->netCents(), '10 % off 49.80 € is 44.82 €.');
        self::assertSame(1, (new InvoiceLine('x', 1000, 'C62', 5, discountBp: 1250))->discountCents(), '12.5 % of 5 cents = 0.625 rounds half up to 1 cent.');

        $invoice = Samples::all()['regelbesteuert'];
        self::assertSame(62382, $invoice->netTotal());
        self::assertSame([
            ['category' => 'S', 'rate' => 19, 'basis' => 49900, 'tax' => 9481],
            ['category' => 'S', 'rate' => 7, 'basis' => 4482, 'tax' => 314],
            ['category' => 'E', 'rate' => 0, 'basis' => 8000, 'tax' => 0],
        ], $invoice->vatBreakdown());
        self::assertSame(72177, $invoice->grossTotal());
    }

    public function testSmallBusinessInvoiceCarriesNoVat(): void
    {
        $invoice = Samples::all()['kleinunternehmer'];
        self::assertSame(0, $invoice->taxTotal());
        self::assertSame($invoice->netTotal(), $invoice->grossTotal());

        $xpath = self::xpath(ZugferdXml::xml($invoice));
        self::assertSame('E', $xpath->evaluate('string(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode)'));
        self::assertSame(Invoice::SMALL_BUSINESS_NOTE, $xpath->evaluate('string(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:ExemptionReason)'));
        self::assertSame('0.00', $xpath->evaluate('string(//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount)'));
        self::assertSame('619.00', $xpath->evaluate('string(//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount)'));
        self::assertSame('123/456/78901', $xpath->evaluate("string(//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='FC'])"));
        // BR-CO-26: without a VAT id the seller identifier (BT-29) must be present.
        self::assertSame('123/456/78901', $xpath->evaluate('string(//ram:SellerTradeParty/ram:ID)'));
    }

    public function testNamesTheBuyersContactPerson(): void
    {
        $xpath = self::xpath(ZugferdXml::xml(Samples::all()['kleinunternehmer']));
        self::assertSame('Erika Beispiel', $xpath->evaluate('string(//ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName)'));
    }

    public function testUsesTheEn16931Profile(): void
    {
        $xpath = self::xpath(ZugferdXml::xml(Samples::all()['kleinunternehmer']));
        self::assertSame('urn:cen.eu:en16931:2017', $xpath->evaluate('string(//ram:GuidelineSpecifiedDocumentContextParameter/ram:ID)'));
    }

    public function testCancellationReferencesTheOriginalInvoice(): void
    {
        $xpath = self::xpath(ZugferdXml::xml(Samples::all()['kleinunternehmer-storno']));
        self::assertSame('381', $xpath->evaluate('string(//rsm:ExchangedDocument/ram:TypeCode)'));
        self::assertSame('R-2026-0001', $xpath->evaluate('string(//ram:InvoiceReferencedDocument/ram:IssuerAssignedID)'));
        self::assertSame(0.0, $xpath->evaluate('count(//ram:SpecifiedTradeSettlementPaymentMeans)'));
    }

    public function testEverySampleIsValidAgainstTheSchema(): void
    {
        foreach (Samples::all() as $name => $invoice) {
            $validator = new ZugferdXsdValidator(ZugferdXml::builder($invoice));
            $validator->validate();
            self::assertSame([], $validator->validationErrors(), $name);
        }
    }

    public function testHybridPdfEmbedsTheSameXml(): void
    {
        $invoice = Samples::all()['kleinunternehmer'];
        $files = HybridInvoice::create($invoice, true);

        self::assertStringStartsWith('%PDF-', $files['pdf']);
        self::assertStringContainsString('factur-x.xml', $files['pdf']);
        $read = ZugferdDocumentReader::readAndGuessFromContent($files['xml']);
        $read->getDocumentInformation($number, $type, $date, $invoiceCurrency, $taxCurrency, $documentName, $language, $period);
        self::assertSame('R-2026-0001', $number);
        self::assertSame(HybridInvoice::create($invoice, true), $files, 'Deterministic mode renders the same bytes.');
    }

    public function testRejectsInvalidInvoices(): void
    {
        $samples = Samples::all();
        $base = $samples['kleinunternehmer'];
        $cases = [
            'VAT for a small business' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, [new InvoiceLine('x', 1000, 'C62', 100, 19)], true, $base->iban),
            'exempt line without reason' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, [new InvoiceLine('x', 1000, 'C62', 100, 0)], false, $base->iban),
            'bad IBAN' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, $base->lines, true, 'DE00 0000 0000 0000 0000 00'),
            'no lines' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, [], true, $base->iban),
            'lower-case number' => fn () => new Invoice('r-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, $base->lines, true, $base->iban),
            'due before issue' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, new DateTimeImmutable('2020-01-01'), $base->seller, $base->buyer, $base->lines, true, $base->iban),
            'cancellation without original' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, $base->seller, $base->buyer, $base->lines, true, $base->iban, type: Invoice::TYPE_CREDIT_NOTE),
            'seller without tax id' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, new Party('A', 'B', '1', 'C'), $base->buyer, $base->lines, true, $base->iban),
            'seller without VAT id or identifier' => fn () => new Invoice('R-1', $base->issueDate, $base->deliveryDate, $base->dueDate, new Party('A', 'B', '1', 'C', taxNumber: '1/2/3'), $base->buyer, $base->lines, true, $base->iban),
            'unknown unit' => fn () => new InvoiceLine('x', 1000, 'XYZ', 100),
            'zero quantity' => fn () => new InvoiceLine('x', 0, 'C62', 100),
            '16 percent' => fn () => new InvoiceLine('x', 1000, 'C62', 100, 16),
        ];
        foreach ($cases as $label => $make) {
            try {
                $make();
                self::fail("Accepted: $label");
            } catch (InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testValidatesIbans(): void
    {
        self::assertTrue(Invoice::isValidIban('DE89 3704 0044 0532 0130 00'));
        self::assertTrue(Invoice::isValidIban('de89370400440532013000'));
        self::assertFalse(Invoice::isValidIban('DE89 3704 0044 0532 0130 01'));
        self::assertFalse(Invoice::isValidIban('not an iban'));
    }

    public function testFormatsGermanNumbers(): void
    {
        self::assertSame("1.234,50\u{00A0}€", InvoicePdf::money(123450));
        self::assertSame('1,5', InvoicePdf::quantity(1500));
        self::assertSame('2', InvoicePdf::quantity(2000));
        self::assertSame('0,25', InvoicePdf::quantity(250));
    }

    private static function xpath(string $xml): DOMXPath
    {
        $doc = new DOMDocument();
        self::assertTrue($doc->loadXML($xml));
        $xpath = new DOMXPath($doc);
        $xpath->registerNamespace('rsm', 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100');
        $xpath->registerNamespace('ram', 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100');

        return $xpath;
    }
}
