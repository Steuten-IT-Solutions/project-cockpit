<?php

/**
 * Cron job, called by cron/run.sh (see there) every 15 minutes, or directly:
 *   php /path/to/cockpit/cron/run.php
 *
 * Phase 1 applies pending migrations and records the run, so the dashboard
 * proves that the scheduler works and shows which PHP version it uses.
 */

declare(strict_types=1);

use Cockpit\Config;
use Cockpit\Database\Connection;
use Cockpit\Database\Migrator;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
date_default_timezone_set('UTC');

$config = Config::load($root . '/config/config.php');
$pdo = Connection::create($config->database);

// One run at a time, even if the scheduler overlaps.
$lock = 1;
if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
    $stmt = $pdo->prepare("SELECT GET_LOCK('cockpit_cron', 0)");
    $stmt->execute();
    $lock = (int)$stmt->fetchColumn();
}
if ($lock !== 1) {
    fwrite(STDERR, "Another run is in progress.\n");
    exit(0);
}

$applied = (new Migrator($pdo, $root . '/migrations'))->migrate();

$start = gmdate('Y-m-d H:i:s');
$insert = $pdo->prepare(
    'INSERT INTO cron_runs (started_at, php_version, php_sapi, status) VALUES (?, ?, ?, ?)'
);
$insert->execute([$start, PHP_VERSION, PHP_SAPI, 'running']);
$runId = (int)$pdo->lastInsertId();

$status = 'ok';
$message = $applied === [] ? null : 'Migrationen angewendet: ' . implode(', ', $applied);

if (version_compare(PHP_VERSION, '8.3.0', '<')) {
    $status = 'warn';
    $message = 'PHP ' . PHP_VERSION . ' ist zu alt; im Cron-Manager PHP 8.4 wählen.';
}
// Later phases add their jobs here (GitHub, Vercel, status reports), each with
// its own error handling so one failing source does not stop the others.

$pdo->prepare('UPDATE cron_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
    ->execute([gmdate('Y-m-d H:i:s'), $status, $message, $runId]);

// Keep 30 days of history.
$pdo->prepare('DELETE FROM cron_runs WHERE started_at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);

echo sprintf("%s %s\n", $status, $message ?? '');
exit(0);
