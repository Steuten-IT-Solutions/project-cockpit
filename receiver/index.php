<?php

declare(strict_types=1);

/*
 * Document root of the status subdomain (e.g. https://status.steuten-it-solutions.de/).
 * Accepts status reports of the company apps at POST / and, with a bug_reports section, bug reports at
 * POST /reports; everything else answers 404. The overview lives in the cockpit behind its login.
 */

use Cockpit\Config;
use Cockpit\Database\Connection;
use Cockpit\Http\Response;
use Cockpit\Reports\BugReportReceiver;
use Cockpit\Reports\BugReportRepository;
use Cockpit\Reports\BugReportStore;
use Cockpit\Reports\BugReportSync;
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

$afterResponse = null;
try {
    $config = Config::load($root . '/config/config.php');
    $org = $config->statusReports['org'] ?? null;
    $method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    $path = parse_url(is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
    $path = is_string($path) ? $path : '';
    $isReport = $path === '/reports';
    if ($org === null || ($isReport && $config->bugReports === null)) {
        $response = Receiver::json(404, ['error' => 'not found']);
    } else {
        // One byte more than allowed, so that an oversized report is recognised without reading all of it.
        $limit = $isReport ? BugReportReceiver::MAX_BODY : Receiver::MAX_BODY;
        $body = $method === 'POST' ? (string)file_get_contents('php://input', false, null, 0, $limit + 1) : '';
        // One connection for both formats, opened only once a report passed validation.
        $pdo = null;
        $connect = static function () use (&$pdo, $config): PDO {
            return $pdo ??= Connection::create($config->database);
        };
        $signature = is_string($_SERVER['HTTP_X_KOMPANIE_SIGNATURE'] ?? null) ? $_SERVER['HTTP_X_KOMPANIE_SIGNATURE'] : '';
        if ($isReport) {
            $crypto = new Crypto($config->appKey);
            $receiver = new BugReportReceiver(static fn (): BugReportStore => new BugReportRepository($connect()), $org, $crypto);
            $response = $method === 'POST'
                ? $receiver->handle($body, $signature, is_string($_SERVER['REMOTE_ADDR'] ?? null) ? $_SERVER['REMOTE_ADDR'] : '', time())
                : Receiver::json(404, ['error' => 'not found']);
            // Create the issue right away when the server can finish the response first (PHP-FPM); else the cron does.
            if ($response->status === 201 && function_exists('fastcgi_finish_request')) {
                $afterResponse = static function () use ($config, $connect): void {
                    BugReportSync::fromConfig($config, new BugReportRepository($connect()))?->run(time(), 3);
                };
            }
        } else {
            $receiver = new Receiver(
                static fn (): StatusRepository => new StatusRepository($connect()),
                $org,
                static fn (): InstallationStore => new InstallationRepository($connect()),
                new Crypto($config->appKey),
            );
            $response = $receiver->handle($method, $path, $body, time(), $signature);
        }
    }
} catch (Throwable $e) {
    // Details go to the server log only.
    error_log(sprintf('[cockpit receiver] %s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
    $response = Receiver::json(500, ['error' => 'internal']);
}
$response->send();

if ($afterResponse !== null) {
    fastcgi_finish_request();
    try {
        $afterResponse();
    } catch (Throwable $e) {
        // The report is stored; the cron job tries again.
        error_log(sprintf('[cockpit receiver] bug report issue: %s: %s', $e::class, $e->getMessage()));
    }
}
