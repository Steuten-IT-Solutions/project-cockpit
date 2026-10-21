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
     * @param array{email: string, from: string}|null $alerts
     * @param array{private_key_file: string, subject: string}|null $push
     * @param array{repo: string, label_prefix: string, client_id: ?string, private_key_file: ?string}|null $bugReports
     * @param array{repo: string, webhook_secret: ?string}|null $releases
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
        public readonly ?array $alerts = null,
        public readonly ?array $push = null,
        public readonly ?array $bugReports = null,
        public readonly ?array $releases = null,
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

        return new self($baseUrl, $appKey, $setupToken, $database, $idle, $absolute, $timezone, self::github($raw), self::vercel($raw), self::statusReports($raw), self::alerts($raw), self::push($raw), self::bugReports($raw), self::releases($raw));
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
     * The optional alerts section: where alert e-mails go and who sends them (PHP mail()).
     * "from" must be an address of the cockpit's own domain, or the host's mail server refuses it.
     *
     * @param array<mixed> $raw
     * @return array{email: string, from: string}|null
     */
    private static function alerts(array $raw): ?array
    {
        $section = $raw['alerts'] ?? null;
        if ($section === null) {
            return null;
        }
        if (!is_array($section)) {
            throw new RuntimeException('alerts must be an array.');
        }
        $email = self::string($section, 'email');
        $from = self::string($section, 'from');
        $fromAddress = preg_match('/^[^<>\r\n]*<([^<>\r\n]+)>$/', $from, $m) ? $m[1] : $from;
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || filter_var($fromAddress, FILTER_VALIDATE_EMAIL) === false
            || preg_match('/[\r\n]/', $from)) {
            throw new RuntimeException('alerts.email and alerts.from must be e-mail addresses.');
        }

        return ['email' => $email, 'from' => $from];
    }

    /**
     * The optional push section: VAPID key (EC P-256, PEM file next to config.php) and a contact
     * for the push services. The key file is only read when needed.
     *
     * @param array<mixed> $raw
     * @return array{private_key_file: string, subject: string}|null
     */
    private static function push(array $raw): ?array
    {
        $section = $raw['push'] ?? null;
        if ($section === null) {
            return null;
        }
        if (!is_array($section)) {
            throw new RuntimeException('push must be an array.');
        }
        $subject = self::string($section, 'subject');
        if (!preg_match('#^(mailto:[^\s@]+@[^\s@]+|https://\S+)$#', $subject)) {
            throw new RuntimeException('push.subject must be a mailto: or https:// address.');
        }

        return ['private_key_file' => self::string($section, 'private_key_file'), 'subject' => $subject];
    }

    /**
     * The optional bug_reports section: bug reports of the company apps (Kompanie-App-Template#64) become issues in
     * this (private) repository, labelled with label_prefix and the company's repository name. The GitHub App of the
     * github section creates them, unless client_id and private_key_file name a separate app for this repository.
     *
     * @param array<mixed> $raw
     * @return array{repo: string, label_prefix: string, client_id: ?string, private_key_file: ?string}|null
     */
    private static function bugReports(array $raw): ?array
    {
        $section = $raw['bug_reports'] ?? null;
        if ($section === null) {
            return null;
        }
        if (!is_array($section)) {
            throw new RuntimeException('bug_reports must be an array.');
        }
        $repo = self::string($section, 'repo');
        if (!preg_match('#^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$#D', $repo)) {
            throw new RuntimeException('bug_reports.repo must be owner/name.');
        }
        $prefix = $section['label_prefix'] ?? 'kompanie:';
        if (!is_string($prefix) || $prefix === '' || mb_strlen($prefix) > 20 || preg_match('/[\x00-\x1F,]/', $prefix)) {
            throw new RuntimeException('bug_reports.label_prefix must be a short text without commas.');
        }
        $clientId = isset($section['client_id']) ? self::string($section, 'client_id') : null;
        $keyFile = isset($section['private_key_file']) ? self::string($section, 'private_key_file') : null;
        if (($clientId === null) !== ($keyFile === null)) {
            throw new RuntimeException('bug_reports.client_id and bug_reports.private_key_file go together.');
        }
        if ($clientId === null && !isset($raw['github'])) {
            throw new RuntimeException('bug_reports needs the github section or its own client_id and private_key_file.');
        }

        return ['repo' => $repo, 'label_prefix' => $prefix, 'client_id' => $clientId, 'private_key_file' => $keyFile];
    }

    /**
     * The optional releases section: running and recent releases of the company app template (workflows
     * "Kernversion freigeben" and "Kompanien abgleichen"). The cron job reads them with the GitHub App of the github
     * section; with webhook_secret the status subdomain also accepts the app's webhook at POST /github, so a release
     * shows up within seconds.
     *
     * @param array<mixed> $raw
     * @return array{repo: string, webhook_secret: ?string}|null
     */
    private static function releases(array $raw): ?array
    {
        $section = $raw['releases'] ?? null;
        if ($section === null) {
            return null;
        }
        if (!is_array($section)) {
            throw new RuntimeException('releases must be an array.');
        }
        $repo = self::string($section, 'repo');
        if (!preg_match('#^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$#D', $repo)) {
            throw new RuntimeException('releases.repo must be owner/name.');
        }
        if (!isset($raw['github'])) {
            throw new RuntimeException('releases needs the github section.');
        }
        $secret = isset($section['webhook_secret']) ? self::string($section, 'webhook_secret') : null;
        if ($secret !== null && strlen($secret) < 32) {
            throw new RuntimeException('releases.webhook_secret must be at least 32 characters long.');
        }

        return ['repo' => $repo, 'webhook_secret' => $secret];
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
