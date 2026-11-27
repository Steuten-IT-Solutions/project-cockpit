<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use FPDF;

/**
 * Human-readable PDF of an invoice, drawn from the same Invoice object as the XML
 * so that both parts carry the same figures (BMF 15.10.2024, Rz. 31 f.).
 * Fonts are embedded (DejaVu Sans), as PDF/A-3 requires.
 */
final class InvoicePdf
{
    private const LEFT = 20.0;
    private const WIDTH = 170.0;

    /**
     * @param array{logo?: array{data: string, type: string}, title?: string, meta?: array<string, string>, closing?: string, watermark?: string} $options
     *        logo: PNG or JPEG bytes printed top left; title, meta and closing replace the invoice's heading,
     *        date block and payment text (used for quotes and order confirmations); watermark: e.g. "ENTWURF"
     */
    public static function render(Invoice $invoice, string $fontDir, array $options = []): string
    {
        $pdf = new class ('P', 'mm', 'A4') extends FPDF {
            private ?int $created = null;

            /** Fixed creation date, so the same invoice always renders to the same bytes. */
            public function setCreated(int $timestamp): void
            {
                $this->created = $timestamp;
            }

            protected function _putinfo(): void
            {
                // _enddoc() sets CreationDate to time() right before this is called.
                if ($this->created !== null) {
                    $this->CreationDate = $this->created;
                }
                parent::_putinfo();
            }
        };
        // FPDF reads font definitions from this directory (see FPDF::AddFont()).
        $pdf->AddFont('DejaVu', '', 'DejaVuSans.json', $fontDir);
        $pdf->AddFont('DejaVu', 'B', 'DejaVuSans-Bold.json', $fontDir);
        $pdf->SetMargins(self::LEFT, 20, 20);
        $pdf->SetAutoPageBreak(true, 30);
        $title = $options['title'] ?? self::title($invoice);
        $pdf->SetTitle($title . ' ' . $invoice->number, true);
        $pdf->SetAuthor($invoice->seller->name, true);
        $pdf->SetCreator('Steuten IT Cockpit', true);
        $pdf->setCreated($invoice->issueDate->getTimestamp());
        $pdf->AddPage();

        $seller = $invoice->seller;
        $buyer = $invoice->buyer;

        if (isset($options['watermark'])) {
            $pdf->SetFont('DejaVu', 'B', 60);
            $pdf->SetTextColor(225, 225, 225);
            $pdf->SetXY(self::LEFT, 140);
            $pdf->Cell(self::WIDTH, 30, self::t($options['watermark']), 0, 0, 'C');
            $pdf->SetTextColor(0, 0, 0);
        }
        if (isset($options['logo'])) {
            self::logo($pdf, $options['logo']);
        }

        // Sender line and address block (DIN 5008 window position).
        $pdf->SetFont('DejaVu', '', 7.5);
        $pdf->SetXY(self::LEFT, 47);
        $pdf->Cell(85, 4, self::t("{$seller->name} · {$seller->street} · {$seller->postcode} {$seller->city}"));
        $pdf->SetFont('DejaVu', '', 10);
        $pdf->SetXY(self::LEFT, 53);
        // The customer's contact person goes below the name (DIN 5008, without "z. Hd.").
        $address = [$buyer->name];
        if ($buyer->contactName !== null && trim($buyer->contactName) !== '' && $buyer->contactName !== $buyer->name) {
            $address[] = $buyer->contactName;
        }
        array_push($address, $buyer->street, "{$buyer->postcode} {$buyer->city}");
        $pdf->MultiCell(85, 5, self::t(implode("\n", $address)));

        // Seller block on the right.
        $pdf->SetXY(125, 20);
        $pdf->SetFont('DejaVu', 'B', 11);
        $pdf->Cell(65, 6, self::t($seller->name), 0, 2);
        $pdf->SetFont('DejaVu', '', 9);
        $contact = array_filter([$seller->street, "{$seller->postcode} {$seller->city}", $seller->email, $seller->phone]);
        $pdf->MultiCell(65, 4.5, self::t(implode("\n", $contact)));

        // Document information.
        $meta = [
            'Rechnungsnummer' => $invoice->number,
            'Rechnungsdatum' => $invoice->issueDate->format('d.m.Y'),
            'Leistungsdatum' => $invoice->deliveryDate->format('d.m.Y'),
            'Fällig am' => $invoice->dueDate->format('d.m.Y'),
        ];
        if ($invoice->type === Invoice::TYPE_CREDIT_NOTE) {
            unset($meta['Fällig am']);
            $meta['Storniert'] = (string)$invoice->precedingNumber;
        }
        $meta = $options['meta'] ?? $meta;
        $pdf->SetXY(125, 60);
        foreach ($meta as $label => $value) {
            $pdf->SetX(125);
            $pdf->SetFont('DejaVu', '', 9);
            $pdf->Cell(30, 5, self::t($label));
            $pdf->SetFont('DejaVu', 'B', 9);
            $pdf->Cell(35, 5, self::t($value), 0, 1, 'R');
        }

        $pdf->SetXY(self::LEFT, 95);
        $pdf->SetFont('DejaVu', 'B', 15);
        $pdf->Cell(self::WIDTH, 8, self::t($title . ' ' . $invoice->number), 0, 1);
        if ($invoice->note !== null && trim($invoice->note) !== '') {
            $pdf->SetFont('DejaVu', '', 10);
            $pdf->MultiCell(self::WIDTH, 5, self::t($invoice->note), 0, 'L');
        }
        $pdf->Ln(3);

        // Lines.
        $cols = [['Pos.', 12, 'L'], ['Bezeichnung', 78, 'L'], ['Menge', 25, 'R'], ['Einzelpreis', 27, 'R'], ['Betrag', 28, 'R']];
        if (!$invoice->smallBusiness) {
            $cols = [['Pos.', 12, 'L'], ['Bezeichnung', 66, 'L'], ['Menge', 25, 'R'], ['Einzelpreis', 25, 'R'], ['USt', 14, 'R'], ['Betrag', 28, 'R']];
        }
        $pdf->SetFont('DejaVu', 'B', 9);
        foreach ($cols as [$label, $w, $align]) {
            $pdf->Cell($w, 7, self::t($label), 'B', 0, $align);
        }
        $pdf->Ln();
        $pdf->SetFont('DejaVu', '', 9);
        foreach ($invoice->lines as $i => $line) {
            $cells = [
                [(string)($i + 1), 12, 'L'],
                [$line->name, $invoice->smallBusiness ? 78 : 66, 'L'],
                [self::quantity($line->quantityMilli) . ' ' . InvoiceLine::UNITS[$line->unit], 25, 'R'],
                [self::money($line->unitPriceCents), $invoice->smallBusiness ? 27 : 25, 'R'],
            ];
            if (!$invoice->smallBusiness) {
                $cells[] = [$line->vatRate . ' %', 14, 'R'];
            }
            $cells[] = [self::money($line->netCents()), 28, 'R'];
            foreach ($cells as [$value, $w, $align]) {
                $pdf->Cell($w, 6, self::t($value), 0, 0, $align);
            }
            $pdf->Ln();
            if ($line->discountBp > 0) {
                $pdf->SetX(self::LEFT + 12);
                $pdf->SetFont('DejaVu', '', 8);
                $pdf->MultiCell($cols[1][1], 4, self::t('Rabatt ' . self::percent($line->discountBp) . ' auf '
                    . self::money($line->amountBeforeDiscountCents()) . ': ' . self::money(-$line->discountCents())), 0, 'L');
                $pdf->SetFont('DejaVu', '', 9);
            }
            if ($line->description !== null && trim($line->description) !== '') {
                $pdf->SetX(self::LEFT + 12);
                $pdf->SetFont('DejaVu', '', 8);
                $pdf->MultiCell($cols[1][1], 4, self::t($line->description), 0, 'L');
                $pdf->SetFont('DejaVu', '', 9);
            }
        }
        $pdf->Cell(self::WIDTH, 2, '', 'B', 1);
        $pdf->Ln(2);

        // Totals.
        $totals = [];
        if ($invoice->smallBusiness) {
            $totals[] = ['Gesamtbetrag', self::money($invoice->grossTotal()), true];
        } else {
            $totals[] = ['Summe netto', self::money($invoice->netTotal()), false];
            foreach ($invoice->vatBreakdown() as $group) {
                $label = $group['category'] === 'E' ? 'Steuerfrei auf ' . self::money($group['basis']) : "Umsatzsteuer {$group['rate']} % auf " . self::money($group['basis']);
                $totals[] = [$label, self::money($group['tax']), false];
            }
            $totals[] = ['Gesamtbetrag', self::money($invoice->grossTotal()), true];
        }
        foreach ($totals as [$label, $value, $bold]) {
            $pdf->SetFont('DejaVu', $bold ? 'B' : '', $bold ? 10 : 9);
            $pdf->Cell(self::WIDTH - 35, 6, self::t($label), 0, 0, 'R');
            $pdf->Cell(35, 6, self::t($value), 0, 1, 'R');
        }
        $pdf->Ln(4);

        $pdf->SetFont('DejaVu', '', 9);
        $notes = [];
        if ($invoice->vatBreakdown() !== [] && in_array('E', array_column($invoice->vatBreakdown(), 'category'), true)) {
            $notes[] = $invoice->exemptionText();
        }
        $notes[] = $options['closing'] ?? ($invoice->type === Invoice::TYPE_CREDIT_NOTE
            ? 'Diese Stornorechnung hebt die Rechnung ' . $invoice->precedingNumber . ' vollständig auf.'
            : 'Zahlbar ohne Abzug bis zum ' . $invoice->dueDate->format('d.m.Y')
                . ' unter Angabe der Rechnungsnummer auf das unten genannte Konto.');
        $pdf->MultiCell(self::WIDTH, 5, self::t(implode("\n", $notes)), 0, 'L');

        // Footer with the seller's mandatory details, on the last page.
        $pdf->SetAutoPageBreak(false);
        $pdf->SetY(-30);
        $pdf->SetFont('DejaVu', '', 7.5);
        $ids = array_filter([
            $seller->taxNumber !== null ? 'Steuernummer ' . $seller->taxNumber : null,
            $seller->vatId !== null ? 'USt-IdNr. ' . $seller->vatId : null,
        ]);
        $bank = 'IBAN ' . trim(chunk_split(strtoupper(str_replace(' ', '', $invoice->iban)), 4, ' '))
            . ($invoice->bic !== null ? ' · BIC ' . $invoice->bic : '');
        $pdf->MultiCell(self::WIDTH, 3.8, self::t(implode("\n", [
            "{$seller->name} · {$seller->street} · {$seller->postcode} {$seller->city}",
            implode(' · ', $ids),
            $bank,
        ])), 'T', 'C');

        return $pdf->Output('S');
    }

    /**
     * The logo in the top left corner, at most 70 x 25 mm, keeping its proportions.
     *
     * @param array{data: string, type: string} $logo
     */
    private static function logo(FPDF $pdf, array $logo): void
    {
        $type = match ($logo['type']) {
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            default => throw new \InvalidArgumentException('The logo must be a PNG or JPEG image.'),
        };
        $size = getimagesizefromstring($logo['data']);
        if ($size === false || $size[0] <= 0 || $size[1] <= 0) {
            throw new \InvalidArgumentException('The logo cannot be read.');
        }
        $scale = min(70 / $size[0], 25 / $size[1]);
        // FPDF reads images from files only.
        $file = tempnam(sys_get_temp_dir(), 'logo');
        if ($file === false) {
            throw new \RuntimeException('No temporary file for the logo.');
        }
        try {
            file_put_contents($file, $logo['data']);
            $pdf->Image($file, self::LEFT, 15, $size[0] * $scale, $size[1] * $scale, $type);
        } finally {
            unlink($file);
        }
    }

    public static function title(Invoice $invoice): string
    {
        return $invoice->type === Invoice::TYPE_CREDIT_NOTE ? 'Stornorechnung' : 'Rechnung';
    }

    /** German money format with the euro sign, e.g. "1.234,50 €". */
    public static function money(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';

        return $sign . number_format(abs($cents) / 100, 2, ',', '.') . "\u{00A0}€";
    }

    /** "1", "1,5", "0,25" from thousandths. */
    /** 1000 → "10 %", 1250 → "12,5 %" (hundredths of a percent). */
    public static function percent(int $basisPoints): string
    {
        $text = number_format($basisPoints / 100, 2, ',', '.');

        return rtrim(rtrim($text, '0'), ',') . "\u{00A0}%";
    }

    public static function quantity(int $milli): string
    {
        $text = number_format($milli / 1000, 3, ',', '.');

        return rtrim(rtrim($text, '0'), ',');
    }

    /** FPDF's core encoding is Windows-1252; characters outside it become "?". */
    private static function t(string $utf8): string
    {
        return (string)mb_convert_encoding($utf8, 'Windows-1252', 'UTF-8');
    }
}
