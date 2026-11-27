<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use DateTimeImmutable;
use InvalidArgumentException;

/**
 * The bridge to the Nuxt cockpit: it sends a document as JSON to bin/invoice.php, which
 * builds the Invoice from it here and returns PDF and XML. The field names are the
 * camelCase names of app/server/lib/erp/document.ts.
 */
final class JsonDocument
{
    /** What the PDF is: an e-invoice (PDF + XML), a draft preview, a quote or an order confirmation. */
    public const MODES = ['invoice', 'draft', 'quote', 'order'];

    /**
     * @param array<mixed> $data
     */
    public static function invoice(array $data): Invoice
    {
        $lines = [];
        foreach (self::list($data, 'lines') as $line) {
            $lines[] = new InvoiceLine(
                self::string($line, 'name'),
                self::int($line, 'quantityMilli'),
                self::string($line, 'unit'),
                self::int($line, 'unitPriceCents'),
                self::int($line, 'vatRate'),
                self::optional($line, 'description'),
            );
        }
        $seller = self::party(self::map($data, 'seller'), true);

        return new Invoice(
            self::string($data, 'number'),
            self::date($data, 'issueDate'),
            self::date($data, 'deliveryDate'),
            self::date($data, 'dueDate'),
            $seller,
            self::party(self::map($data, 'buyer'), false),
            $lines,
            ($data['smallBusiness'] ?? null) === true,
            self::string($data, 'iban'),
            self::optional($data, 'bic'),
            self::optional($data, 'type') ?? Invoice::TYPE_INVOICE,
            self::optional($data, 'exemptionReason'),
            self::optional($data, 'note'),
            self::optional($data, 'precedingNumber'),
        );
    }

    /**
     * PDF options for the mode: quotes and order confirmations get their own heading,
     * dates and closing text; drafts a watermark. A draft is mode "draft" (an invoice) or
     * any mode with "draft": true (a quote or order confirmation not issued yet).
     *
     * @param array<mixed> $data
     * @return array{logo?: array{data: string, type: string}, title?: string, meta?: array<string, string>, closing?: string, watermark?: string}
     */
    public static function options(array $data, Invoice $invoice): array
    {
        $options = [];
        $logo = $data['logo'] ?? null;
        if (is_array($logo)) {
            $bytes = base64_decode(self::string($logo, 'data'), true);
            if ($bytes === false) {
                throw new InvalidArgumentException('The logo is not valid base64.');
            }
            $options['logo'] = ['data' => $bytes, 'type' => self::string($logo, 'type')];
        }
        $mode = self::mode($data);
        if ($mode === 'draft' || ($data['draft'] ?? null) === true) {
            $options['watermark'] = 'ENTWURF';
        }
        if ($mode === 'quote') {
            $options['title'] = 'Angebot';
            $options['meta'] = [
                'Angebotsnummer' => $invoice->number,
                'Datum' => $invoice->issueDate->format('d.m.Y'),
                'Gültig bis' => $invoice->dueDate->format('d.m.Y'),
            ];
            $options['closing'] = 'Dieses Angebot gilt bis zum ' . $invoice->dueDate->format('d.m.Y')
                . '. Wir freuen uns auf Ihren Auftrag.';
        }
        if ($mode === 'order') {
            $options['title'] = 'Auftragsbestätigung';
            $options['meta'] = [
                'Auftragsnummer' => $invoice->number,
                'Datum' => $invoice->issueDate->format('d.m.Y'),
                'Leistung bis' => $invoice->deliveryDate->format('d.m.Y'),
            ];
            $options['closing'] = 'Vielen Dank für Ihren Auftrag. Die Rechnung folgt nach Erbringung der Leistung.';
        }

        return $options;
    }

    /** @param array<mixed> $data */
    public static function mode(array $data): string
    {
        $mode = self::optional($data, 'mode') ?? 'invoice';
        if (!in_array($mode, self::MODES, true)) {
            throw new InvalidArgumentException("Unknown mode '$mode'.");
        }

        return $mode;
    }

    /** @param array<mixed> $data */
    private static function party(array $data, bool $seller): Party
    {
        $taxNumber = self::optional($data, 'taxNumber');
        $vatId = self::optional($data, 'vatId');

        return new Party(
            self::string($data, 'name'),
            self::string($data, 'street'),
            self::string($data, 'postcode'),
            self::string($data, 'city'),
            self::optional($data, 'country') ?? 'DE',
            $taxNumber,
            $vatId,
            self::optional($data, 'email'),
            self::optional($data, 'phone'),
            self::optional($data, 'contactName'),
            // EN 16931 BR-CO-26: without a VAT id the seller is identified by its tax number.
            $seller && $vatId === null ? $taxNumber : null,
        );
    }

    /**
     * @param array<mixed> $data
     * @return array<mixed>
     */
    private static function map(array $data, string $key): array
    {
        $value = $data[$key] ?? null;
        if (!is_array($value)) {
            throw new InvalidArgumentException("Field '$key' must be an object.");
        }

        return $value;
    }

    /**
     * @param array<mixed> $data
     * @return list<array<mixed>>
     */
    private static function list(array $data, string $key): array
    {
        $value = $data[$key] ?? null;
        if (!is_array($value) || !array_is_list($value)) {
            throw new InvalidArgumentException("Field '$key' must be a list.");
        }
        $items = [];
        foreach ($value as $item) {
            if (!is_array($item)) {
                throw new InvalidArgumentException("Entries of '$key' must be objects.");
            }
            $items[] = $item;
        }

        return $items;
    }

    /** @param array<mixed> $data */
    private static function string(array $data, string $key): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value)) {
            throw new InvalidArgumentException("Field '$key' must be a string.");
        }

        return $value;
    }

    /** @param array<mixed> $data */
    private static function optional(array $data, string $key): ?string
    {
        $value = $data[$key] ?? null;
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_string($value)) {
            throw new InvalidArgumentException("Field '$key' must be a string.");
        }

        return $value;
    }

    /** @param array<mixed> $data */
    private static function int(array $data, string $key): int
    {
        $value = $data[$key] ?? null;
        if (!is_int($value)) {
            throw new InvalidArgumentException("Field '$key' must be an integer.");
        }

        return $value;
    }

    /** @param array<mixed> $data */
    private static function date(array $data, string $key): DateTimeImmutable
    {
        $value = self::string($data, $key);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new InvalidArgumentException("Field '$key' must be a date YYYY-MM-DD.");
        }

        return $date;
    }
}
