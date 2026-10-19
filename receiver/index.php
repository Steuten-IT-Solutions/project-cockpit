<?php

declare(strict_types=1);

/*
 * Document root of the status subdomain (e.g. https://status.steuten-it-solutions.de/).
 * Accepts status reports of the company apps at POST /; everything else answers 404.
 * The overview lives in the cockpit behind its login.
 */

use Cockpit\Config;
use Cockpit\Database\Connection;
use Cockpit\Http\Response;
use Cockpit\Security\Crypto;
use Cockpit\Status\InstallationRepository;
use Cockpit\Status\InstallationStore;
use Cockpit\Status\Receiver;
use Cockpit\Status\StatusRepository;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';

ini_set('display_errors', '0');
ini_set('log_errors', '1');

foreach ([
    'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options' => 'nosniff',
    'Referrer-Policy' => 'no-referrer',
    'X-Robots-Tag' => 'noindex, nofollow',
    'Cache-Control' => 'no-store',
    'Strict-Transport-Security' => 'max-age=31536000',
] as $name => $value) {
    header($name . ': ' . $value);
}

try {
    $config = Config::load($root . '/config/config.php');
    $org = $config->statusReports['org'] ?? null;
    if ($org === null) {
        $response = Receiver::json(404, ['error' => 'not found']);
    } else {
        $method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
        $path = parse_url(is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
        // One byte more than allowed, so that an oversized report is recognised without reading all of it.
        $body = $method === 'POST' ? (string)file_get_contents('php://input', false, null, 0, Receiver::MAX_BODY + 1) : '';
        // One connection for both formats, opened only once a report passed validation.
        $pdo = null;
        $connect = static function () use (&$pdo, $config): PDO {
            return $pdo ??= Connection::create($config->database);
        };
        $receiver = new Receiver(
            static fn (): StatusRepository => new StatusRepository($connect()),
            $org,
            static fn (): InstallationStore => new InstallationRepository($connect()),
            new Crypto($config->appKey),
        );
        $signature = is_string($_SERVER['HTTP_X_KOMPANIE_SIGNATURE'] ?? null) ? $_SERVER['HTTP_X_KOMPANIE_SIGNATURE'] : '';
        $response = $receiver->handle($method, is_string($path) ? $path : '', $body, time(), $signature);
    }
} catch (Throwable $e) {
    // Details go to the server log only.
    error_log(sprintf('[cockpit receiver] %s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
    $response = Receiver::json(500, ['error' => 'internal']);
}
$response->send();
