<?php

declare(strict_types=1);

namespace Cockpit;

use RuntimeException;

/**
 * Validated, read-only view of config/config.php.
 */
final class Config
{
    /**
     * @param array{dsn: string, user: string, password: string} $database
     */
    private function __construct(
        public readonly string $baseUrl,
        public readonly string $appKey,
        public readonly string $setupToken,
        public readonly array $database,
        public readonly int $idleTimeout,
        public readonly int $absoluteTimeout,
        public readonly string $timezone,
    ) {
    }

    public static function load(string $file): self
    {
        if (!is_file($file)) {
            throw new RuntimeException('Configuration file is missing.');
        }

        $raw = require $file;
        if (!is_array($raw)) {
            throw new RuntimeException('Configuration file must return an array.');
        }

        return self::fromArray($raw);
    }

    /**
     * @param array<mixed> $raw
     */
    public static function fromArray(array $raw): self
    {
        $baseUrl = self::string($raw, 'base_url');
        if (!preg_match('#^https?://[^/]+$#', $baseUrl)) {
            throw new RuntimeException('base_url must be an origin without a trailing slash.');
        }

        $appKey = base64_decode(self::string($raw, 'app_key'), true);
        if ($appKey === false || strlen($appKey) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            throw new RuntimeException('app_key must be 32 random bytes, base64-encoded.');
        }

        $setupToken = is_string($raw['setup_token'] ?? null) ? $raw['setup_token'] : '';
        if ($setupToken !== '' && strlen($setupToken) < 32) {
            throw new RuntimeException('setup_token must be empty or at least 32 characters long.');
        }

        $db = $raw['database'] ?? null;
        if (!is_array($db)) {
            throw new RuntimeException('database section is missing.');
        }
        $database = [
            'dsn' => self::string($db, 'dsn'),
            'user' => self::string($db, 'user'),
            'password' => is_string($db['password'] ?? null) ? $db['password'] : '',
        ];

        $session = is_array($raw['session'] ?? null) ? $raw['session'] : [];
        $idle = self::positiveInt($session, 'idle_timeout', 7200);
        $absolute = self::positiveInt($session, 'absolute_timeout', 43200);

        $timezone = is_string($raw['timezone'] ?? null) ? $raw['timezone'] : 'Europe/Berlin';
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            throw new RuntimeException('timezone is not a valid identifier.');
        }

        return new self($baseUrl, $appKey, $setupToken, $database, $idle, $absolute, $timezone);
    }

    /**
     * @param array<mixed> $raw
     */
    private static function string(array $raw, string $key): string
    {
        $value = $raw[$key] ?? null;
        if (!is_string($value) || $value === '' || str_contains($value, 'CHANGE-ME')) {
            throw new RuntimeException(sprintf('Configuration value "%s" is missing.', $key));
        }

        return $value;
    }

    /**
     * @param array<mixed> $raw
     */
    private static function positiveInt(array $raw, string $key, int $default): int
    {
        $value = $raw[$key] ?? $default;
        if (!is_int($value) || $value <= 0) {
            throw new RuntimeException(sprintf('Configuration value "%s" must be a positive integer.', $key));
        }

        return $value;
    }
}
