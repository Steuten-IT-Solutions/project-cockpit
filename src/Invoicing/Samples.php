<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use DateTimeImmutable;

/**
 * Fictitious invoices covering the cases the cockpit supports. Used by the tests and
 * by bin/einvoice-samples.php, whose output CI validates with Mustang.
 */
final class Samples
{
    /**
     * @return array<string, Invoice>
     */
    public static function all(): array
    {
        $seller = new Party(
            'Muster IT', 'Musterstraße 1', '12345', 'Musterstadt', 'DE',
            taxNumber: '123/456/78901', email: 'rechnung@example.org', phone: '+49 123 456789', contactName: 'Max Muster',
            id: '123/456/78901',
        );
        $buyer = new Party('Kompanie Beispiel GmbH', 'Hauptstraße 2', '54321', 'Beispielstadt', email: 'buchhaltung@example.com', contactName: 'Erika Beispiel');
        $iban = 'DE89 3704 0044 0532 0130 00';
        $issued = new DateTimeImmutable('2026-11-20');
        $delivered = new DateTimeImmutable('2026-11-15');
        $due = new DateTimeImmutable('2026-12-04');

        $smallBusinessLines = [
            new InvoiceLine('Kompanie-App, Kauf und Einrichtung', 1000, 'LS', 49900, description: 'Einrichtung der App für die Kompanie inkl. Domain-Anbindung'),
            new InvoiceLine('Schulung der Administratoren', 1500, 'HUR', 8000),
        ];

        return [
            'kleinunternehmer' => new Invoice('R-2026-0001', $issued, $delivered, $due, $seller, $buyer, $smallBusinessLines, true, $iban),
            'kleinunternehmer-storno' => new Invoice(
                'R-2026-0002', $issued, $delivered, $issued, $seller, $buyer, $smallBusinessLines, true, $iban,
                type: Invoice::TYPE_CREDIT_NOTE, precedingNumber: 'R-2026-0001',
                note: 'Stornierung der Rechnung R-2026-0001 vom 20.11.2026.',
            ),
            'regelbesteuert' => new Invoice(
                'R-2027-0001', $issued, $delivered, $due,
                new Party('Muster IT', 'Musterstraße 1', '12345', 'Musterstadt', 'DE', taxNumber: '123/456/78901', vatId: 'DE123456789'),
                $buyer,
                [
                    new InvoiceLine('Kompanie-App, Kauf und Einrichtung', 1000, 'LS', 49900, 19),
                    new InvoiceLine('Fachbuch', 2000, 'C62', 2490, 7, discountBp: 1000),
                    new InvoiceLine('Schulung (steuerfrei)', 1000, 'HUR', 8000, 0),
                ],
                false, $iban, bic: 'COBADEFFXXX', exemptionReason: 'Steuerfreie Leistung (Beispieltext für den Test).',
            ),
        ];
    }
}
