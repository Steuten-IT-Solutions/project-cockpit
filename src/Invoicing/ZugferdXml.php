<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use horstoeko\zugferd\ZugferdDocumentBuilder;
use horstoeko\zugferd\ZugferdProfiles;

/**
 * Writes an invoice as Factur-X/ZUGFeRD CII XML in the EN 16931 profile
 * (BMF 15.10.2024, Rz. 25 and 30: MINIMUM and BASIC-WL are not e-invoices).
 */
final class ZugferdXml
{
    public static function builder(Invoice $invoice): ZugferdDocumentBuilder
    {
        $b = ZugferdDocumentBuilder::createNew(ZugferdProfiles::PROFILE_EN16931);
        $b->setDocumentInformation($invoice->number, $invoice->type, $invoice->issueDate, 'EUR');
        if ($invoice->note !== null && trim($invoice->note) !== '') {
            $b->addDocumentNote($invoice->note);
        }
        if ($invoice->smallBusiness) {
            $b->addDocumentNote(Invoice::SMALL_BUSINESS_NOTE);
        }
        if ($invoice->precedingNumber !== null) {
            $b->setDocumentInvoiceReferencedDocument($invoice->precedingNumber);
        }

        $seller = $invoice->seller;
        $b->setDocumentSeller($seller->name, $seller->id);
        if ($seller->taxNumber !== null) {
            $b->addDocumentSellerTaxNumber($seller->taxNumber);
        }
        if ($seller->vatId !== null) {
            $b->addDocumentSellerVATRegistrationNumber($seller->vatId);
        }
        $b->setDocumentSellerAddress($seller->street, null, null, $seller->postcode, $seller->city, $seller->country);
        if ($seller->email !== null || $seller->phone !== null) {
            $b->setDocumentSellerContact($seller->contactName ?? $seller->name, null, $seller->phone, null, $seller->email);
        }
        if ($seller->email !== null) {
            $b->setDocumentSellerCommunication('EM', $seller->email);
        }

        $buyer = $invoice->buyer;
        $b->setDocumentBuyer($buyer->name);
        if ($buyer->vatId !== null) {
            $b->addDocumentBuyerVATRegistrationNumber($buyer->vatId);
        }
        $b->setDocumentBuyerAddress($buyer->street, null, null, $buyer->postcode, $buyer->city, $buyer->country);
        if ($buyer->email !== null) {
            $b->setDocumentBuyerCommunication('EM', $buyer->email);
        }

        $b->setDocumentSupplyChainEvent($invoice->deliveryDate);
        if ($invoice->type === Invoice::TYPE_INVOICE) {
            $b->addDocumentPaymentMeanToCreditTransfer(strtoupper(str_replace(' ', '', $invoice->iban)), $seller->name, null, $invoice->bic, $invoice->number);
            $b->addDocumentPaymentTerm('Zahlbar ohne Abzug bis ' . $invoice->dueDate->format('d.m.Y') . '.', $invoice->dueDate);
        }

        foreach ($invoice->vatBreakdown() as $group) {
            $exempt = $group['category'] === 'E';
            $b->addDocumentTax(
                $group['category'],
                'VAT',
                self::eur($group['basis']),
                self::eur($group['tax']),
                (float)$group['rate'],
                $exempt ? $invoice->exemptionText() : null,
            );
        }

        foreach ($invoice->lines as $i => $line) {
            $b->addNewPosition((string)($i + 1));
            $b->setDocumentPositionProductDetails($line->name, $line->description);
            $b->setDocumentPositionNetPrice(self::eur($line->unitPriceCents));
            $b->setDocumentPositionQuantity($line->quantityMilli / 1000, $line->unit);
            $b->addDocumentPositionTax($invoice->categoryOf($line), 'VAT', (float)$line->vatRate);
            if ($line->discountBp > 0) {
                // Line allowance (BG-27): reason code 95 is "Discount" in UNTDID 5189.
                $b->addDocumentPositionAllowanceCharge(
                    self::eur($line->discountCents()),
                    false,
                    $line->discountBp / 100,
                    self::eur($line->amountBeforeDiscountCents()),
                    '95',
                    'Rabatt',
                );
            }
            $b->setDocumentPositionLineSummation(self::eur($line->netCents()));
        }

        $net = self::eur($invoice->netTotal());
        $b->setDocumentSummation(
            self::eur($invoice->grossTotal()),
            self::eur($invoice->grossTotal()),
            $net,
            0.0,
            0.0,
            $net,
            self::eur($invoice->taxTotal()),
        );

        return $b;
    }

    public static function xml(Invoice $invoice): string
    {
        return self::builder($invoice)->getContent();
    }

    private static function eur(int $cents): float
    {
        return $cents / 100;
    }
}
