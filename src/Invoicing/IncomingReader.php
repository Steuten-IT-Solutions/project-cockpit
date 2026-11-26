<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use DateTime;
use horstoeko\zugferd\ZugferdDocumentPdfReader;
use horstoeko\zugferd\ZugferdDocumentReader;
use InvalidArgumentException;
use Throwable;

/**
 * Reads the structured part of an incoming e-invoice: CII XML (XRechnung in CII syntax,
 * ZUGFeRD, Factur-X) or a ZUGFeRD/Factur-X PDF with the XML embedded. For a hybrid
 * invoice the XML is what counts (BMF 15.10.2024, Rz. 31), so these values are shown,
 * not what the PDF prints. XRechnung in UBL syntax is not supported (see the plan).
 */
final class IncomingReader
{
    /**
     * @return array{
     *   format: string, number: string, typeCode: string, issueDate: ?string, dueDate: ?string, deliveryDate: ?string,
     *   currency: string, supplier: array{name: string, vatId: ?string, taxNumber: ?string, street: ?string, postcode: ?string, city: ?string, country: ?string, email: ?string},
     *   iban: ?string, netCents: int, taxCents: int, grossCents: int, dueCents: int,
     *   lines: list<array{name: string, quantity: float, unit: string, netCents: int, vatRate: float}>,
     *   taxes: list<array{category: string, rate: float, basisCents: int, taxCents: int}>
     * }
     */
    public static function read(string $bytes): array
    {
        $isPdf = str_starts_with($bytes, '%PDF');
        try {
            $reader = $isPdf ? ZugferdDocumentPdfReader::readAndGuessFromContent($bytes) : ZugferdDocumentReader::readAndGuessFromContent($bytes);
        } catch (Throwable $e) {
            throw new InvalidArgumentException($isPdf ? 'The PDF contains no readable e-invoice XML.' : 'The file is no CII e-invoice (UBL is not supported).', 0, $e);
        }

        $reader->getDocumentInformation($number, $typeCode, $issueDate, $currency, $taxCurrency, $name, $language, $period);
        $reader->getDocumentSeller($sellerName, $sellerIds, $sellerDescription);
        $reader->getDocumentSellerTaxRegistration($taxReg);
        $reader->getDocumentSellerAddress($street, $lineTwo, $lineThree, $postcode, $city, $country, $subDivision);
        $email = null;
        try {
            $reader->getDocumentSellerContact($contactName, $department, $phone, $fax, $email);
        } catch (Throwable) {
            $email = null;
        }
        $reader->getDocumentSupplyChainEvent($deliveryDate);
        $reader->getDocumentSummation($grand, $duePayable, $lineTotal, $charges, $allowances, $taxBasis, $taxTotal, $rounding, $prepaid);

        $iban = null;
        if ($reader->firstGetDocumentPaymentMeans()) {
            do {
                $reader->getDocumentPaymentMeans($code, $info, $cardType, $cardId, $cardHolder, $buyerIban, $payeeIban, $accountName, $propId, $bic);
                if ($iban === null && is_string($payeeIban) && $payeeIban !== '') {
                    $iban = strtoupper(str_replace(' ', '', $payeeIban));
                }
            } while ($reader->nextGetDocumentPaymentMeans());
        }
        $dueDate = null;
        if ($reader->firstDocumentPaymentTerms()) {
            $reader->getDocumentPaymentTerm($termText, $termDue, $mandate);
            $dueDate = $termDue;
        }

        $lines = [];
        if ($reader->firstDocumentPosition()) {
            do {
                $reader->getDocumentPositionProductDetails($lineName, $lineDescription, $sellerId, $buyerId, $globalType, $globalId);
                $reader->getDocumentPositionQuantity($quantity, $unit, $free, $freeUnit, $package, $packageUnit);
                $reader->getDocumentPositionLineSummation($lineAmount, $lineAllowances);
                $rate = 0.0;
                if ($reader->firstDocumentPositionTax()) {
                    $reader->getDocumentPositionTax($category, $taxType, $rate, $calculated, $reason, $reasonCode);
                }
                $lines[] = [
                    'name' => (string)$lineName,
                    'quantity' => (float)$quantity,
                    'unit' => (string)$unit,
                    'netCents' => self::cents($lineAmount),
                    'vatRate' => (float)$rate,
                ];
            } while ($reader->nextDocumentPosition());
        }

        $taxes = [];
        if ($reader->firstDocumentTax()) {
            do {
                $reader->getDocumentTax($category, $taxType, $basis, $calculated, $rate, $reason, $reasonCode, $lineTotalBasis, $allowanceBasis, $taxPointDate, $dueDateCode);
                $taxes[] = ['category' => (string)$category, 'rate' => (float)$rate, 'basisCents' => self::cents($basis), 'taxCents' => self::cents($calculated)];
            } while ($reader->nextDocumentTax());
        }

        $taxNumber = $taxReg['FC'] ?? null;
        $vatId = $taxReg['VA'] ?? null;

        return [
            'format' => $isPdf ? 'zugferd-pdf' : 'cii-xml',
            'number' => (string)$number,
            'typeCode' => (string)$typeCode,
            'issueDate' => self::day($issueDate),
            'dueDate' => self::day($dueDate),
            'deliveryDate' => self::day($deliveryDate),
            'currency' => (string)($currency ?? 'EUR'),
            'supplier' => [
                'name' => (string)$sellerName,
                'vatId' => is_string($vatId) && $vatId !== '' ? $vatId : null,
                'taxNumber' => is_string($taxNumber) && $taxNumber !== '' ? $taxNumber : null,
                'street' => self::text($street),
                'postcode' => self::text($postcode),
                'city' => self::text($city),
                'country' => self::text($country),
                'email' => self::text($email),
            ],
            'iban' => $iban,
            'netCents' => self::cents($taxBasis ?? $lineTotal),
            'taxCents' => self::cents($taxTotal),
            'grossCents' => self::cents($grand),
            'dueCents' => self::cents($duePayable ?? $grand),
            'lines' => $lines,
            'taxes' => $taxes,
        ];
    }

    private static function cents(?float $amount): int
    {
        return (int)round(($amount ?? 0.0) * 100);
    }

    private static function day(mixed $date): ?string
    {
        return $date instanceof DateTime ? $date->format('Y-m-d') : null;
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
