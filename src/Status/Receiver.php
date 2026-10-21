<?php

declare(strict_types=1);

namespace Cockpit\Status;

use Closure;
use Cockpit\Http\Response;
use Cockpit\Security\Crypto;

/**
 * Accepts status reports at POST / of the status subdomain (receiver/index.php).
 *
 * Format 1 (daily, unsigned; until all installations are updated): 2000 stored rows, rows without a
 * new report for 60 days are removed.
 *
 * Format 2 (Kompanie-App-Template docs/STATUSMELDUNGEN.md): hourly heartbeats and events, signed
 * with HMAC-SHA256 (header X-Kompanie-Signature) and a secret per installation. The secret is
 * learned from the first report of an unknown installation (field "key", trust on first use) and
 * stored encrypted; later reports must carry a valid signature, and a "key" never replaces it.
 * "sent" must lie within REPLAY_WINDOW of the receiver's clock and "nonce" must be new.
 *
 * Both formats: at most MAX_BODY per report, 2000 reports per hour in total. The database is only opened once a report
 * passed validation, so junk requests never open a connection.
 */
final class Receiver
{
    /** Room for the causes of format 2 ("details", up to 10 per code and hour); a report without them stays under 2 KiB. */
    public const MAX_BODY = 16384;
    public const MAX_PER_HOUR = 2000;
    public const MAX_ROWS = 2000;
    public const KEEP_DAYS = 60;
    /** Format 2: at most this many installations. */
    public const MAX_INSTALLATIONS = 2000;
    /** Format 2: seconds a report's "sent" may differ from the receiver's clock. */
    public const REPLAY_WINDOW = 600;
    public const SIGNATURE_HEADER = 'X-Kompanie-Signature';

    /**
     * @param Closure(): StatusRepository $repository format 1
     * @param (Closure(): InstallationStore)|null $installations format 2 (null: format 2 is refused)
     */
    public function __construct(
        private readonly Closure $repository,
        private readonly string $org,
        private readonly ?Closure $installations = null,
        private readonly ?Crypto $crypto = null,
    ) {
    }

    /**
     * @param string $signature value of the X-Kompanie-Signature header ('' if missing)
     */
    public function handle(string $method, string $path, string $body, int $now, string $signature = ''): Response
    {
        if ($method !== 'POST' || $path !== '/') {
            return self::json(404, ['error' => 'not found']);
        }
        if (strlen($body) > self::MAX_BODY) {
            return self::json(413, ['error' => 'too large']);
        }
        try {
            $payload = json_decode($body, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::json(400, ['error' => 'invalid']);
        }
        if (is_array($payload) && ($payload['format'] ?? null) === 2) {
            return $this->format2($payload, $body, $signature, $now);
        }
        $row = StatusReport::fromPayload($payload, $this->org, $now);
        if ($row === null) {
            return self::json(400, ['error' => 'invalid']);
        }

        $repository = ($this->repository)();
        if ($repository->countInHour(gmdate('YmdH', $now), gmdate('YmdH', $now - 86400)) > self::MAX_PER_HOUR) {
            return self::json(429, ['error' => 'too many reports']);
        }
        // Prune first, then count: a full table frees up once old rows expire.
        $repository->pruneBefore(gmdate('Y-m-d H:i:s', $now - self::KEEP_DAYS * 86400));
        if (!$repository->exists($row['kompanie'], $row['variant']) && $repository->count() >= self::MAX_ROWS) {
            return self::json(507, ['error' => 'full']);
        }
        $repository->save($row, gmdate('Y-m-d H:i:s', $now));

        return self::json(200, ['ok' => true]);
    }

    /**
     * Signature header value for a body: "sha256=" and the hex HMAC-SHA256 with the secret.
     */
    public static function sign(string $body, string $secretHex): string
    {
        return 'sha256=' . hash_hmac('sha256', $body, $secretHex);
    }

    /**
     * @param array<mixed> $payload
     */
    private function format2(array $payload, string $body, string $signature, int $now): Response
    {
        $report = StatusReport::fromFormat2($payload, $this->org, $now);
        if ($report === null || $this->installations === null || $this->crypto === null) {
            return self::json(400, ['error' => 'invalid', 'code' => 'invalid']);
        }
        if (abs($report['sent'] - $now) > self::REPLAY_WINDOW) {
            return self::json(409, ['error' => 'outside the time window', 'code' => 'replay']);
        }

        $store = ($this->installations)();
        // Counted before any other database work, rejected attempts included.
        if ($store->countInHour(gmdate('YmdH', $now), gmdate('YmdH', $now - 86400)) > self::MAX_PER_HOUR) {
            return self::json(429, ['error' => 'too many reports', 'code' => 'rate_limited']);
        }
        $at = gmdate('Y-m-d H:i:s', $now);
        $known = $store->find($report['installation']);
        if ($known === null) {
            if ($report['key'] === null) {
                return self::json(409, ['error' => 'unknown installation', 'code' => 'unknown_installation']);
            }
            if (!hash_equals(self::sign($body, $report['key']), $signature)) {
                return self::json(401, ['error' => 'bad signature', 'code' => 'bad_signature']);
            }
            // Only companies with a repository of ours: otherwise anyone could register installations.
            if (!$store->companyKnown($report['kompanie'])) {
                return self::json(403, ['error' => 'unknown company', 'code' => 'unknown_company']);
            }
            if ($store->count() >= self::MAX_INSTALLATIONS) {
                return self::json(507, ['error' => 'full', 'code' => 'full']);
            }
            if (!$store->register($report, $this->crypto->encrypt($report['key']), $at)) {
                // Registered by a parallel first report: its secret decides.
                $known = $store->find($report['installation']);
            }
        }
        // The stored secret decides; a "key" in the report never replaces it. The signature proves the
        // installation, so a renamed company or a changed variant is taken over.
        if ($known !== null && !hash_equals(self::sign($body, $this->crypto->decrypt($known['secret_enc'])), $signature)) {
            return self::json(401, ['error' => 'bad signature', 'code' => 'bad_signature']);
        }
        if (!$store->claimNonce($report['installation'], $report['nonce'], $at)) {
            return self::json(409, ['error' => 'report seen before', 'code' => 'replay']);
        }
        $store->record($report, $at);

        return self::json(201, ['ok' => true]);
    }

    /**
     * @param array<string, mixed> $body
     */
    public static function json(int $status, array $body): Response
    {
        return new Response($status, (string)json_encode($body), ['Content-Type' => 'application/json; charset=utf-8']);
    }
}
