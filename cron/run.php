<?php

/**
 * Cron job, called by cron/run.sh (see there) every 15 minutes, or directly:
 *   php /path/to/cockpit/cron/run.php
 *
 * The work itself is in Cockpit\Jobs\Runner, which the dashboard's refresh button uses too.
 */

declare(strict_types=1);

use Cockpit\Config;
use Cockpit\Database\Connection;
use Cockpit\Jobs\Runner;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
date_default_timezone_set('UTC');

$config = Config::load($root . '/config/config.php');
$result = (new Runner($config, Connection::create($config->database), $root))->run();

if ($result === null) {
    fwrite(STDERR, "Another run is in progress.\n");
    exit(0);
}

echo sprintf("%s %s\n", $result['status'], $result['message'] ?? '');
exit(0);
