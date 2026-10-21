<?php

declare(strict_types=1);

namespace Cockpit\Reports;

use Closure;
use Cockpit\Http\Response;
use Cockpit\Security\Crypto;
use Cockpit\Status\Receiver;

/**
 * Accepts bug reports at POST /reports of the status subdomain (receiver/index.php; Kompanie-App-Template
 * docs/FEHLERMELDUNGEN.md).
 *
 * Signed like status reports (HMAC-SHA256, header X-Kompanie-Signature) with the installation's secret: the one stored
 * from its status reports, else the one learned from its first bug report (field "key", trust on first use; a "key"
 * never replaces a stored secret). "sent" must lie within the replay window and "nonce" must be new.
 *
 * Limits: body size (screenshot at most 2 MB decoded), reports per hour per IP (keyed hash), per installation and
 * in total. Answers 2xx only once the report is stored; the issue is created afterwards (BugReportSync).
 */
final class BugReportReceiver
{
    /** 2 MB image as base64 plus the texts and JSON around it */
    public const MAX_BODY = 3_000_000;
    public const PER_IP_HOUR = 30;
    public const PER_INSTALLATION_HOUR = 10;
    public const TOTAL_HOUR = 200;

    /**
     * @param Closure(): BugReportStore $store opened only once a report passed validation
     */
    public function __construct(
        private readonly Closure $store,
        private readonly string $org,
        private readonly Crypto $crypto,
    ) {
    }

    /**
     * @param string $signature value of the X-Kompanie-Signature header ('' if missing)
     * @param string $ip REMOTE_ADDR, only used as a keyed hash for the rate limit
     */
    public function handle(string $body, string $signature, string $ip, int $now): Response
    {
        if (strlen($body) > self::MAX_BODY) {
            return Receiver::json(413, ['error' => 'too large', 'code' => 'too_large']);
        }
        try {
            $payload = json_decode($body, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return Receiver::json(400, ['error' => 'invalid', 'code' => 'invalid']);
        }
        $report = BugReport::fromPayload($payload, $this->org, $now);
        if ($report === null) {
            return Receiver::json(400, ['error' => 'invalid', 'code' => 'invalid']);
        }
        if (abs($report['sent'] - $now) > Receiver::REPLAY_WINDOW) {
            return Receiver::json(409, ['error' => 'outside the time window', 'code' => 'replay']);
        }

        $store = ($this->store)();
        $hour = gmdate('YmdH', $now);
        // Counted before any other database work, rejected attempts included.
        if ($store->hit('ip:' . $this->crypto->hash('bug-report-ip', $ip), $hour) > self::PER_IP_HOUR
            || $store->hit('inst:' . $report['installation'], $hour) > self::PER_INSTALLATION_HOUR
            || $store->hit('all', $hour) > self::TOTAL_HOUR) {
            return Receiver::json(429, ['error' => 'too many reports', 'code' => 'rate_limited']);
        }

        $known = $store->secretFor($report['installation']);
        if ($known === null) {
            if ($report['key'] === null) {
                return Receiver::json(409, ['error' => 'unknown installation', 'code' => 'unknown_installation']);
            }
            if (!hash_equals(Receiver::sign($body, $report['key']), $signature)) {
                return Receiver::json(401, ['error' => 'bad signature', 'code' => 'bad_signature']);
            }
            if (!$store->companyKnown($report['kompanie'])) {
                return Receiver::json(403, ['error' => 'unknown company', 'code' => 'unknown_company']);
            }
            if (!$store->registerSecret($report['installation'], $report['kompanie'], $this->crypto->encrypt($report['key']), gmdate('Y-m-d H:i:s', $now))) {
                // Registered by a parallel request: its secret decides.
                $known = $store->secretFor($report['installation']);
            }
        }
        if ($known !== null && !hash_equals(Receiver::sign($body, $this->crypto->decrypt($known['secret_enc'])), $signature)) {
            return Receiver::json(401, ['error' => 'bad signature', 'code' => 'bad_signature']);
        }
        $at = gmdate('Y-m-d H:i:s', $now);
        if (!$store->claimNonce($report['installation'], $report['nonce'], $at)) {
            return Receiver::json(409, ['error' => 'report seen before', 'code' => 'replay']);
        }
        // Sent again because the app missed our answer: already stored, no second issue.
        if ($store->exists($report['installation'], $report['report_id'])) {
            return Receiver::json(200, ['ok' => true, 'duplicate' => true]);
        }
        $store->store($report, $at);

        return Receiver::json(201, ['ok' => true]);
    }
}
