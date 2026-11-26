<?php

/**
 * Writes the environment file of the Nuxt cockpit (app/) from the PHP cockpit's config.php,
 * so both use the same values on the cutover day and nothing is typed by hand.
 *
 *   php bin/config-to-env.php /srv/cockpit/app/config/config.php [options] > /etc/cockpit/app.env
 *
 * Options:
 *   --database=NAME        another database on the same server (the rehearsal's copy)
 *   --set=NAME=VALUE       an extra or overriding variable, may be repeated
 *
 * The output is a systemd EnvironmentFile: one NAME="value" per line, with \ " $ and `
 * escaped by a backslash. Values with line breaks are refused. Called by
 * bin/server-setup.sh (steps "node", "rehearsal" and "cutover"); see app/README.md.
 */

declare(strict_types=1);

const RECEIVER_HOST = 'status.steuten-it-solutions.de';

function fail(string $message): never
{
    fwrite(STDERR, "config-to-env: $message\n");
    exit(1);
}

/**
 * The parts of a DSN like "mysql:host=localhost;port=3306;dbname=cockpit", keys in lower case.
 *
 * @return array<string, string>
 */
function dsnParts(string $dsn): array
{
    if (!str_starts_with($dsn, 'mysql:')) {
        fail('database.dsn must start with "mysql:".');
    }
    $parts = [];
    foreach (explode(';', substr($dsn, 6)) as $pair) {
        if (trim($pair) === '') {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $pair, 2), 2, '');
        $parts[strtolower(trim($key))] = trim($value);
    }
    return $parts;
}

/**
 * mysql://user:password@host:port/database for mysql2. PDO connects to "localhost" over the
 * Unix socket, not TCP; mysql2 does so only with socketPath, so the URL says it explicitly.
 *
 * @param array<mixed> $database the database section of config.php
 */
function databaseUrl(array $database, ?string $name): string
{
    $parts = dsnParts((string) ($database['dsn'] ?? ''));
    $db = $name ?? ($parts['dbname'] ?? '');
    if ($db === '' || !preg_match('/^[A-Za-z0-9_]+$/', $db)) {
        fail('database.dsn needs a dbname of letters, digits and _.');
    }
    $host = $parts['host'] ?? 'localhost';
    $socket = $parts['unix_socket'] ?? ($host === 'localhost' ? '/run/mysqld/mysqld.sock' : null);
    $port = $parts['port'] ?? '3306';
    $user = rawurlencode((string) ($database['user'] ?? ''));
    $password = rawurlencode((string) ($database['password'] ?? ''));
    $hostPart = str_contains($host, ':') ? "[$host]" : $host;
    $url = "mysql://$user:$password@$hostPart:$port/$db";
    return $socket === null ? $url : $url . '?socketPath=' . rawurlencode($socket);
}

function text(mixed $value): string
{
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    if (is_array($value)) {
        return implode(',', array_map('strval', $value));
    }
    return trim((string) $value);
}

/** One line of a systemd EnvironmentFile. */
function line(string $name, string $value): string
{
    if (preg_match('/[\r\n\0]/', $value)) {
        fail("$name contains a line break.");
    }
    return $name . '="' . addcslashes($value, '\\"$`') . '"';
}

$args = array_slice($argv, 1);
$file = null;
$databaseName = null;
$extra = [];
foreach ($args as $arg) {
    if (str_starts_with($arg, '--database=')) {
        $databaseName = substr($arg, 11);
    } elseif (str_starts_with($arg, '--set=')) {
        [$k, $v] = array_pad(explode('=', substr($arg, 6), 2), 2, '');
        if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $k)) {
            fail("invalid variable name $k");
        }
        $extra[$k] = $v;
    } elseif ($file === null) {
        $file = $arg;
    } else {
        fail("unexpected argument $arg");
    }
}
if ($file === null || !is_file($file)) {
    fail('usage: php config-to-env.php /path/to/config.php [--database=NAME] [--set=NAME=VALUE ...]');
}

$config = require $file;
if (!is_array($config)) {
    fail("$file does not return an array.");
}

$section = static fn (string $name): array => is_array($config[$name] ?? null) ? $config[$name] : [];
$session = $section('session');
$github = $section('github');
$vercel = $section('vercel');
$bug = $section('bug_reports');
$releases = $section('releases');
$alerts = $section('alerts');
$push = $section('push');
$real = realpath($file);
if ($real === false) {
    fail("$file cannot be resolved.");
}
$app = dirname($real, 2);

$env = [
    'NODE_ENV' => 'production',
    // Nitro listens on localhost only; Apache forwards to it (bin/server-setup.sh cutover).
    'HOST' => '127.0.0.1',
    'PORT' => '3000',
    'NUXT_APP_KEY' => text($config['app_key'] ?? ''),
    'NUXT_DATABASE_URL' => databaseUrl($section('database'), $databaseName),
    'NUXT_SECURE_COOKIES' => 'true',
    'NUXT_BASE_URL' => text($config['base_url'] ?? ''),
    'NUXT_TIMEZONE' => text($config['timezone'] ?? 'Europe/Berlin'),
    'NUXT_SETUP_TOKEN' => text($config['setup_token'] ?? ''),
    'NUXT_SESSION_IDLE_TIMEOUT' => text($session['idle_timeout'] ?? 7200),
    'NUXT_SESSION_ABSOLUTE_TIMEOUT' => text($session['absolute_timeout'] ?? 43200),
    'NUXT_GITHUB_CLIENT_ID' => text($github['client_id'] ?? ''),
    'NUXT_GITHUB_PRIVATE_KEY_FILE' => text($github['private_key_file'] ?? ''),
    'NUXT_GITHUB_ACCOUNTS' => text($github['accounts'] ?? []),
    'NUXT_GITHUB_API_BASE' => text($github['api_base'] ?? ''),
    'NUXT_VERCEL_TOKEN' => text($vercel['token'] ?? ''),
    'NUXT_VERCEL_TEAM_ID' => text($vercel['team_id'] ?? ''),
    'NUXT_VERCEL_API_BASE' => text($vercel['api_base'] ?? ''),
    'NUXT_VERCEL_BILLING' => text($vercel['billing'] ?? true),
    'NUXT_STATUS_REPORTS_ORG' => text($section('status_reports')['org'] ?? ''),
    'NUXT_BUG_REPORTS_REPO' => text($bug['repo'] ?? ''),
    'NUXT_BUG_REPORTS_LABEL_PREFIX' => text($bug['label_prefix'] ?? 'kompanie:'),
    'NUXT_BUG_REPORTS_CLIENT_ID' => text($bug['client_id'] ?? ''),
    'NUXT_BUG_REPORTS_PRIVATE_KEY_FILE' => text($bug['private_key_file'] ?? ''),
    'NUXT_RELEASES_REPO' => text($releases['repo'] ?? ''),
    'NUXT_RELEASES_WEBHOOK_SECRET' => text($releases['webhook_secret'] ?? ''),
    'NUXT_ALERTS_EMAIL' => text($alerts['email'] ?? ''),
    'NUXT_ALERTS_FROM' => text($alerts['from'] ?? ''),
    'NUXT_PUSH_PRIVATE_KEY_FILE' => text($push['private_key_file'] ?? ''),
    'NUXT_PUSH_SUBJECT' => text($push['subject'] ?? ''),
    'NUXT_MAIL_SENDMAIL' => '/usr/sbin/sendmail',
    'NUXT_MIGRATIONS_DIR' => $app . '/migrations',
    'NUXT_SCHEDULED_JOBS' => 'true',
    'NUXT_RECEIVER_HOST' => RECEIVER_HOST,
];
if ($env['NUXT_APP_KEY'] === '' || str_contains($env['NUXT_APP_KEY'], 'CHANGE-ME')) {
    fail('app_key is missing.');
}
foreach ($extra as $k => $v) {
    $env[$k] = $v;
}

echo "# Written by bin/config-to-env.php from $file on " . gmdate('Y-m-d H:i') . " UTC. Do not edit:\n";
echo "# change config.php and run \"cockpit-setup node\" again.\n";
foreach ($env as $name => $value) {
    echo line($name, $value), "\n";
}
