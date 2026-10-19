<?php

declare(strict_types=1);

namespace Cockpit\Database;

use PDO;

final class Connection
{
    /**
     * @param array{dsn: string, user: string, password: string} $settings
     */
    public static function create(array $settings): PDO
    {
        $pdo = new PDO($settings['dsn'], $settings['user'], $settings['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            // All timestamps are written and compared in UTC; the UI converts for display.
            $pdo->exec("SET time_zone = '+00:00'");
        }

        return $pdo;
    }
}
