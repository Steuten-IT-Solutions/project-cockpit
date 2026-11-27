<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Invoicing\HybridInvoice;
use Cockpit\Invoicing\IncomingReader;
use Cockpit\Invoicing\Invoice;
use Cockpit\Invoicing\InvoicePdf;
use Cockpit\Invoicing\JsonDocument;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/** The JSON bridge to the Nuxt cockpit (bin/invoice.php) and the reader for incoming e-invoices. */
final class JsonDocumentTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function document(): array
    {
        return [
            'mode' => 'invoice',
            'number' => 'R-2026-0001',
            'issueDate' => '2026-11-26',
            'deliveryDate' => '2026-11-20',
            'dueDate' => '2026-12-10',
            'seller' => ['name' => 'Steuten IT Solutions', 'street' => 'Musterweg 1', 'postcode' => '48143', 'city' => 'Münster', 'country' => 'DE', 'vatId' => 'DE463748776', 'email' => 'info@example.org'],
            'buyer' => ['name' => 'Kunde GmbH', 'street' => 'Weg 2', 'postcode' => '10115', 'city' => 'Berlin', 'country' => 'DE'],
            'lines' => [['name' => 'Beratung', 'description' => null, 'quantityMilli' => 1500, 'unit' => 'HUR', 'unitPriceCents' => 9000, 'vatRate' => 0]],
            'smallBusiness' => true,
            'iban' => 'DE89370400440532013000',
            'logo' => ['data' => base64_encode((string)file_get_contents(dirname(__DIR__) . '/fixtures/logo.png')), 'type' => 'image/png'],
        ];
    }

    public function testBuildsTheInvoiceFromJson(): void
    {
        $invoice = JsonDocument::invoice(self::document());
        self::assertSame('R-2026-0001', $invoice->number);
        self::assertSame(13500, $invoice->grossTotal());
        self::assertSame(Invoice::TYPE_INVOICE, $invoice->type);
        self::assertSame('DE463748776', $invoice->seller->vatId);
        self::assertSame('Gültig bis', array_keys(JsonDocument::options(['mode' => 'quote'] + self::document(), $invoice)['meta'] ?? [])[2]);
        self::assertSame('ENTWURF', JsonDocument::options(['mode' => 'draft'] + self::document(), $invoice)['watermark'] ?? null);
        // A quote not issued yet keeps the quote's heading and gets the watermark too.
        $quoteDraft = JsonDocument::options(['mode' => 'quote', 'draft' => true] + self::document(), $invoice);
        self::assertSame(['Angebot', 'ENTWURF'], [$quoteDraft['title'] ?? null, $quoteDraft['watermark'] ?? null]);
    }

    public function testBuildsDiscountsAndPartialCorrections(): void
    {
        $data = self::document();
        $data['lines'][0]['discountBp'] = 1000;
        self::assertSame(12150, JsonDocument::invoice($data)->grossTotal(), '10 % off 135.00 €.');

        $correction = ['type' => '381', 'precedingNumber' => 'R-2026-0001', 'correction' => true, 'number' => 'R-2026-0002'] + $data;
        $options = JsonDocument::options($correction, JsonDocument::invoice($correction));
        self::assertSame('Rechnungskorrektur', $options['title'] ?? null);
        self::assertSame('R-2026-0001', $options['meta']['Korrektur zu'] ?? null);
        // Without the flag a 381 stays a cancellation with the standard heading.
        $cancellation = ['correction' => false] + $correction;
        self::assertArrayNotHasKey('title', JsonDocument::options($cancellation, JsonDocument::invoice($cancellation)));
    }

    public function testRefusesInvalidInput(): void
    {
        $this->expectException(InvalidArgumentException::class);
        JsonDocument::invoice(['issueDate' => '2026-02-30'] + self::document());
    }

    public function testRefusesUnknownModes(): void
    {
        $this->expectException(InvalidArgumentException::class);
        JsonDocument::mode(['mode' => 'letter']);
    }

    public function testReadsBackWhatItIssued(): void
    {
        $invoice = JsonDocument::invoice(self::document());
        $files = HybridInvoice::create($invoice, true, JsonDocument::options(self::document(), $invoice));
        foreach ([$files['pdf'], $files['xml']] as $bytes) {
            $read = IncomingReader::read($bytes);
            self::assertSame('R-2026-0001', $read['number']);
            self::assertSame('Steuten IT Solutions', $read['supplier']['name']);
            self::assertSame('DE463748776', $read['supplier']['vatId']);
            self::assertSame('DE89370400440532013000', $read['iban']);
            self::assertSame(13500, $read['grossCents']);
            self::assertSame('2026-12-10', $read['dueDate']);
            self::assertCount(1, $read['lines']);
        }
        self::assertSame('zugferd-pdf', IncomingReader::read($files['pdf'])['format']);
    }

    public function testRefusesFilesWithoutAnEInvoice(): void
    {
        $invoice = JsonDocument::invoice(self::document());
        $plain = InvoicePdf::render($invoice, HybridInvoice::fontDir());
        $this->expectException(InvalidArgumentException::class);
        IncomingReader::read($plain);
    }
}
