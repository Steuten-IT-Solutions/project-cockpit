<?php

/**
 * Writes sample e-invoices (PDF + XML) for the CI validation in
 * .github/workflows/einvoice.yml. CLI only.
 *
 * Usage: php bin/einvoice-samples.php <output directory>
 */

declare(strict_types=1);

use Cockpit\Invoicing\HybridInvoice;
use Cockpit\Invoicing\Samples;

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/vendor/autoload.php';

$dir = $argv[1] ?? '';
if ($dir === '') {
    fwrite(STDERR, "Usage: php bin/einvoice-samples.php <output directory>\n");
    exit(2);
}
if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    fwrite(STDERR, "Cannot create $dir\n");
    exit(1);
}

foreach (Samples::all() as $name => $invoice) {
    $files = HybridInvoice::create($invoice, true);
    file_put_contents("$dir/$name.pdf", $files['pdf']);
    file_put_contents("$dir/$name.xml", $files['xml']);
    echo "$dir/$name.pdf\n$dir/$name.xml\n";
}
