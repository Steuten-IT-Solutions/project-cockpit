<?php

/**
 * Copy this file to config/config.php ON THE SERVER and fill in the values.
 * config.php is git-ignored and is never deployed: CI excludes config/config.php.
 * Restrict it to the owner: chmod 600 config/config.php
 *
 * Both secrets can be generated in a password manager as random passwords
 * (letters, digits and symbols, but no single quote ' and no backslash):
 *   app_key      at least 40 characters
 *   setup_token  at least 32 characters
 * Alternatively, with PHP: php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'
 * Keep app_key in the password manager as well; it cannot be recovered.
 */

declare(strict_types=1);

return [
    // Public base URL of the cockpit, without trailing slash.
    'base_url' => 'https://cockpit.steuten-it-solutions.de',

    // A random password of at least 40 characters (or 32 random bytes, base64-encoded).
    // Encrypts TOTP secrets at rest and keys the HMAC used for IP hashes and
    // recovery codes. Changing it invalidates every TOTP enrolment and recovery code.
    'app_key' => 'CHANGE-ME',

    // One-time token for the initial setup page (/setup?token=...).
    // At least 32 characters. The page is disabled as soon as a user exists;
    // remove the value afterwards.
    'setup_token' => '',

    'database' => [
        // IONOS shows host, port, database name and user in the hosting panel.
        'dsn' => 'mysql:host=CHANGE-ME;port=3306;dbname=CHANGE-ME;charset=utf8mb4',
        'user' => 'CHANGE-ME',
        'password' => 'CHANGE-ME',
    ],

    'session' => [
        // Log out after this many seconds without activity.
        'idle_timeout' => 2 * 60 * 60,
        // Log out after this many seconds regardless of activity.
        'absolute_timeout' => 12 * 60 * 60,
    ],

    'timezone' => 'Europe/Berlin',
];
