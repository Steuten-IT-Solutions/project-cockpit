<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use horstoeko\zugferd\ZugferdDocumentPdfBuilder;

/**
 * ZUGFeRD/Factur-X hybrid invoice: the visual PDF as PDF/A-3 with the EN 16931
 * XML embedded as factur-x.xml. The XML is the leading part (BMF 15.10.2024, Rz. 31).
 */
final class HybridInvoice
{
    /** Directory with the FPDF font definitions (resources/fonts). */
    public static function fontDir(): string
    {
        return dirname(__DIR__, 2) . '/resources/fonts';
    }

    /**
     * @param bool $deterministic fixed dates and ids in the PDF, for tests and samples
     * @return array{pdf: string, xml: string}
     */
    public static function create(Invoice $invoice, bool $deterministic = false): array
    {
        $builder = ZugferdXml::builder($invoice);
        $visual = InvoicePdf::render($invoice, self::fontDir());

        $pdf = ZugferdDocumentPdfBuilder::fromPdfString($builder, $visual);
        $pdf->setDeterministicModeEnabled($deterministic);
        $pdf->setAdditionalCreatorTool('Steuten IT Cockpit');
        $pdf->generateDocument();

        return ['pdf' => $pdf->downloadString(), 'xml' => $builder->getContent()];
    }
}
