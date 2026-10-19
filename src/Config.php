<?php

declare(strict_types=1);

namespace Cockpit;

use RuntimeException;

/**
 * Validated, read-only view of config/config.php.
 */
final class Config
{
    public const MIN_PASSPHRASE_LENGTH = 40;

    /**
     * @param array{dsn: string, user: string, password: string} $database
     * @param array{client_id: string, private_key_file: string, accounts: list<string>, api_base: string}|null $github
     * @param array{token: string, team_id: string, api_base: string, billing: bool}|null $vercel
     * @param array{org: string}|null $statusReports
     */
    private function __construct(
        public readonly string $baseUrl,
        public readonly string $appKey,
        public readonly string $setupToken,
        public readonly array $database,
        public readonly int $idleTimeout,
        public readonly int $absoluteTimeout,
        public readonly string $timezone,
        public readonly ?array $github = null,
        public readonly ?array $vercel = null,
        public readonly ?array $statusReports = null,
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

        $appKey = self::appKey(self::string($raw, 'app_key'));

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

        return new self($baseUrl, $appKey, $setupToken, $database, $idle, $absolute, $timezone, self::github($raw), self::vercel($raw), self::statusReports($raw));
    }

    /**
     * Accepts either 32 random bytes, base64-encoded, or a random passphrase of at
     * least MIN_PASSPHRASE_LENGTH characters. A passphrase can be generated in a
     * password manager without any tooling; SHA-256 turns it into a 32-byte key.
     * That is sound only because the passphrase itself is random: a hash adds no
     * strength to a guessable value, hence the length requirement.
     */
    private static function appKey(string $value): string
    {
        $decoded = base64_decode($value, true);
        if ($decoded !== false && strlen($decoded) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            return $decoded;
        }

        if (strlen($value) < self::MIN_PASSPHRASE_LENGTH) {
            throw new RuntimeException(sprintf(
                'app_key must be 32 random bytes, base64-encoded, or a random passphrase of at least %d characters.',
                self::MIN_PASSPHRASE_LENGTH,
            ));
        }

        return hash('sha256', 'project-cockpit app_key v1' . "\0" . $value, true);
    }

    /**
     * The optional github section. The private key file is only read when the cron
     * job syncs, so a missing file cannot take the web interface down.
     *
     * @param array<mixed> $raw
     * @return array{client_id: string, private_key_file: string, accounts: list<string>, api_base: string}|null
     */
    private static function github(array $raw): ?array
    {
        $github = $raw['github'] ?? null;
        if ($github === null) {
            return null;
        }
        if (!is_array($github)) {
            throw new RuntimeException('github must be an array.');
        }

        $accounts = $github['accounts'] ?? null;
        if (!is_array($accounts) || $accounts === []) {
            throw new RuntimeException('github.accounts must list at least one account.');
        }
        $logins = [];
        foreach ($accounts as $account) {
            if (!is_string($account) || !preg_match('/^[A-Za-z0-9-]{1,39}$/', $account)) {
                throw new RuntimeException('github.accounts must contain GitHub logins.');
            }
            $logins[] = $account;
        }

        $apiBase = is_string($github['api_base'] ?? null) ? $github['api_base'] : 'https://api.github.com';
        if (!preg_match('#^https?://[^/]+$#', $apiBase)) {
            throw new RuntimeException('github.api_base must be an origin without a trailing slash.');
        }

        return [
            'client_id' => self::string($github, 'client_id'),
            'private_key_file' => self::string($github, 'private_key_file'),
            'accounts' => $logins,
            'api_base' => $apiBase,
        ];
    }

    /**
     * The optional vercel section: an access token scoped to the team, and the team id.
     *
     * @param array<mixed> $raw
     * @return array{token: string, team_id: string, api_base: string, billing: bool}|null
     */
    private static function vercel(array $raw): ?array
    {
        $vercel = $raw['vercel'] ?? null;
        if ($vercel === null) {
            return null;
        }
        if (!is_array($vercel)) {
            throw new RuntimeException('vercel must be an array.');
        }

        $teamId = self::string($vercel, 'team_id');
        if (!preg_match('/^team_[A-Za-z0-9]+$/', $teamId)) {
            throw new RuntimeException('vercel.team_id must look like team_…');
        }
        $apiBase = is_string($vercel['api_base'] ?? null) ? $vercel['api_base'] : 'https://api.vercel.com';
        if (!preg_match('#^https?://[^/]+$#', $apiBase)) {
            throw new RuntimeException('vercel.api_base must be an origin without a trailing slash.');
        }

        $billing = $vercel['billing'] ?? true;
        if (!is_bool($billing)) {
            throw new RuntimeException('vercel.billing must be true or false.');
        }

        return ['token' => self::string($vercel, 'token'), 'team_id' => $teamId, 'api_base' => $apiBase, 'billing' => $billing];
    }

    /**
     * The optional status_reports section switches the receiver on. Only reports from
     * repositories of this organisation are accepted.
     *
     * @param array<mixed> $raw
     * @return array{org: string}|null
     */
    private static function statusReports(array $raw): ?array
    {
        $section = $raw['status_reports'] ?? null;
        if ($section === null) {
            return null;
        }
        if (!is_array($section)) {
            throw new RuntimeException('status_reports must be an array.');
        }
        $org = self::string($section, 'org');
        if (!preg_match('/^[A-Za-z0-9-]{1,39}$/', $org)) {
            throw new RuntimeException('status_reports.org must be a GitHub organisation login.');
        }

        return ['org' => $org];
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
