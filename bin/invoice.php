<?php

/**
 * The e-invoice engine for the Nuxt cockpit (app/server/lib/erp/engine.ts). The Node
 * process runs it as a child process; JSON goes in on stdin and comes out on stdout.
 * PHP keeps this job because horstoeko/zugferd is the mature library for ZUGFeRD and
 * CI validates its output with Mustang (.github/workflows/einvoice.yml).
 *
 *   php bin/invoice.php render   stdin: a document (src/Invoicing/JsonDocument.php)
 *                                stdout: {"pdf": base64, "xml": string|null}
 *   php bin/invoice.php read     stdin: the bytes of an incoming XML or PDF
 *                                stdout: the fields of src/Invoicing/IncomingReader.php
 *
 * Errors: exit code 2 and {"error": message} for invalid input, 1 for anything else.
 */

declare(strict_types=1);

use Cockpit\Invoicing\HybridInvoice;
use Cockpit\Invoicing\IncomingReader;
use Cockpit\Invoicing\InvoicePdf;
use Cockpit\Invoicing\JsonDocument;

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/vendor/autoload.php';

/** @param array<mixed> $value */
function answer(array $value, int $code = 0): never
{
    echo json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit($code);
}

$input = stream_get_contents(STDIN);
if ($input === false) {
    answer(['error' => 'No input.'], 2);
}

try {
    switch ($argv[1] ?? '') {
        case 'render':
            $data = json_decode($input, true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($data)) {
                answer(['error' => 'The document must be an object.'], 2);
            }
            $invoice = JsonDocument::invoice($data);
            $options = JsonDocument::options($data, $invoice);
            if (JsonDocument::mode($data) === 'invoice') {
                $files = HybridInvoice::create($invoice, false, $options);
                answer(['pdf' => base64_encode($files['pdf']), 'xml' => $files['xml']]);
            }
            answer(['pdf' => base64_encode(InvoicePdf::render($invoice, HybridInvoice::fontDir(), $options)), 'xml' => null]);
            // no break: answer() ends the script
        case 'read':
            answer(IncomingReader::read($input));
            // no break
        default:
            fwrite(STDERR, "Usage: php bin/invoice.php render|read < input\n");
            exit(1);
    }
} catch (InvalidArgumentException|JsonException $e) {
    answer(['error' => $e->getMessage()], 2);
}
