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

// With a logo (PNG with transparency, as the cockpit's settings page accepts it): PDF/A-3
// allows transparency, and Mustang's veraPDF check proves the result still conforms.
$logo = file_get_contents(dirname(__DIR__) . '/tests/fixtures/logo.png');
if ($logo === false) {
    fwrite(STDERR, "tests/fixtures/logo.png is missing\n");
    exit(1);
}
$files = HybridInvoice::create(Samples::all()['kleinunternehmer'], true, ['logo' => ['data' => $logo, 'type' => 'image/png']]);
file_put_contents("$dir/mit-logo.pdf", $files['pdf']);
echo "$dir/mit-logo.pdf\n";
