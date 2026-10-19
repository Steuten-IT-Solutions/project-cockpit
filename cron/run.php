<?php

/**
 * Cron job, called by cron/run.sh (see there) every 15 minutes, or directly:
 *   php /path/to/cockpit/cron/run.php
 *
 * Applies pending migrations, syncs the GitHub repositories (if configured) and
 * records the run, so the dashboard shows that the scheduler works and which PHP it uses.
 */

declare(strict_types=1);

use Cockpit\Config;
use Cockpit\Database\Connection;
use Cockpit\Database\Migrator;
use Cockpit\GitHub\Client;
use Cockpit\GitHub\Sync;
use Cockpit\Projects\ProjectRepository;

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
// Shown on the dashboard, so in German.
$messages = [];
if ($applied !== []) {
    $messages[] = 'Migrationen angewendet: ' . implode(', ', $applied);
}

if (version_compare(PHP_VERSION, '8.3.0', '<')) {
    $status = 'warn';
    $messages[] = 'PHP ' . PHP_VERSION . ' ist zu alt; im Cron-Manager PHP 8.4 wählen.';
}

// Each source has its own error handling, so one failing source does not stop the others.
if ($config->github !== null) {
    try {
        $key = @file_get_contents($config->github['private_key_file']);
        if ($key === false) {
            throw new RuntimeException('Schlüsseldatei der GitHub App nicht lesbar.');
        }
        $client = new Client($config->github['client_id'], $key, $config->github['api_base']);
        $result = (new Sync($client, new ProjectRepository($pdo), $config->github['accounts']))->run(time());
        $messages[] = sprintf('GitHub: %d Repos aktualisiert', $result['repos']);
        if ($result['errors'] !== []) {
            $status = 'warn';
            $messages[] = sprintf('%d Fehler, z. B. %s', count($result['errors']), $result['errors'][0]);
        }
    } catch (Throwable $e) {
        $status = 'warn';
        $messages[] = 'GitHub: ' . $e->getMessage();
    }
}

$message = $messages === [] ? null : mb_substr(implode(' · ', $messages), 0, 255);

$pdo->prepare('UPDATE cron_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
    ->execute([gmdate('Y-m-d H:i:s'), $status, $message, $runId]);

// Keep 30 days of history.
$pdo->prepare('DELETE FROM cron_runs WHERE started_at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);

echo sprintf("%s %s\n", $status, $message ?? '');
exit(0);
