<?php

declare(strict_types=1);

namespace Cockpit\Status;

/**
 * Validates one status report of a company app and maps it to a database row.
 *
 * The payload is built by packages/core/src/Update/StatusReporter.php in
 * Steuten-IT-Solutions/Kompanie-App-Template (format 1). Reports are not signed, so
 * anything may arrive: only known fields with expected shapes are kept, everything
 * else is dropped.
 *
 * @phpstan-type StatusRow array{
 *     kompanie: string, variant: string, version: string, php: string, db_driver: string,
 *     update_ok: ?int, update_at: ?string, update_to: ?string, update_check_ok: int,
 *     gallery_ok: ?int, gallery_at: ?string, sent_at: ?string
 * }
 * @phpstan-type Format2 array{
 *     kompanie: string, variant: string, version: string, php: string, db_driver: string,
 *     update_ok: ?int, update_at: ?string, update_to: ?string, update_check_ok: int,
 *     gallery_ok: ?int, gallery_at: ?string, sent_at: ?string,
 *     installation: string, kind: string, event: ?string, checks: array<string, string>,
 *     errors: array<string, int>, details: array<string, array<string, int>>, detail: ?string,
 *     cron_kind: string, cron_last: ?string, features: list<string>, maintenance: int, sent: int, nonce: string, key: ?string
 * }
 */
final class StatusReport
{
    /** Traffic-light levels of a check. */
    public const LEVELS = ['ok', 'warn', 'error', 'off'];
    /** How background tasks are triggered: real cron, page views only, or WP-Cron. */
    public const CRON_KINDS = ['real', 'pseudo', 'wp'];
    /** Error and event codes (fixed codes, never texts). */
    private const CODE = '/^[A-Z0-9_]{1,40}$/D';
    private const MAX_CHECKS = 20;
    private const MAX_ERRORS = 30;
    /**
     * Causes of an error code (Kompanie-App-Template Telemetry\Detail): fixed parts and patterns, never texts.
     * The app sends at most 10 per code and hour (more count as "other"), so 24 hours may hold more.
     */
    private const CAUSE = '/^[a-z][a-z0-9_]{0,63}$/D';
    private const MAX_CAUSES = 60;
    /** Areas (features) an installation may report; the app adds areas over time. */
    private const MAX_FEATURES = 30;

    /** Earliest timestamp taken from a report (2020-01-01); older values are dropped. */
    private const MIN_TIMESTAMP = 1577836800;
    /** Clock skew tolerated for timestamps in the future. */
    private const MAX_SKEW = 86400;

    /**
     * @return StatusRow|null null if the report is not a valid report of the organisation
     */
    public static function fromPayload(mixed $in, string $org, int $now): ?array
    {
        if (!is_array($in) || ($in['format'] ?? null) !== 1) {
            return null;
        }
        $kompanie = $in['kompanie'] ?? null;
        $version = $in['version'] ?? null;
        $variant = $in['variant'] ?? null;
        if (!is_string($kompanie) || !preg_match('~^' . preg_quote($org, '~') . '/[A-Za-z0-9_.-]{1,100}$~D', $kompanie)
            || !is_string($version) || !preg_match('/^\d{1,4}(\.\d{1,6}){2,3}$/D', $version)
            || !in_array($variant, ['wordpress', 'standalone'], true)) {
            return null;
        }

        $php = $in['php'] ?? null;
        $database = $in['database'] ?? null;
        $update = is_array($in['update'] ?? null) ? $in['update'] : null;
        $gallery = is_array($in['gallery'] ?? null) ? $in['gallery'] : null;
        $updateTo = $update['to'] ?? null;

        return [
            'kompanie' => $kompanie,
            'variant' => $variant,
            'version' => $version,
            'php' => is_string($php) && preg_match('/^\d{1,2}\.\d{1,2}$/D', $php) ? $php : '?',
            'db_driver' => in_array($database, ['mysql', 'sqlite'], true) ? $database : '?',
            'update_ok' => $update === null ? null : (int)(($update['ok'] ?? false) === true),
            'update_at' => $update === null ? null : self::time($update['at'] ?? null, $now),
            'update_to' => is_string($updateTo) && preg_match('/^[0-9.]{1,30}$/D', $updateTo) ? $updateTo : null,
            'update_check_ok' => (int)(($in['updateCheckOk'] ?? false) === true),
            'gallery_ok' => $gallery === null ? null : (int)(($gallery['ok'] ?? false) === true),
            'gallery_at' => $gallery === null ? null : self::time($gallery['at'] ?? null, $now),
            'sent_at' => self::time($in['sent'] ?? null, $now),
        ];
    }

    /**
     * Validates a format 2 report (Kompanie-App-Template docs/STATUSMELDUNGEN.md) strictly against a
     * whitelist. Signature, replay window and nonce are checked by the Receiver.
     *
     * @return Format2|null null if the report is not a valid format 2 report of the organisation
     */
    public static function fromFormat2(mixed $in, string $org, int $now): ?array
    {
        if (!is_array($in) || ($in['format'] ?? null) !== 2) {
            return null;
        }
        $base = self::fromPayload(['format' => 1] + $in, $org, $now);
        $installation = $in['installation'] ?? null;
        $nonce = $in['nonce'] ?? null;
        $kind = $in['kind'] ?? null;
        $sent = $in['sent'] ?? null;
        if ($base === null || !is_string($installation) || !preg_match('/^[0-9a-f]{32}$/D', $installation)
            || !is_string($nonce) || !preg_match('/^[0-9a-f]{16}$/D', $nonce)
            || !in_array($kind, ['heartbeat', 'event'], true) || !is_int($sent)) {
            return null;
        }
        $event = null;
        if ($kind === 'event') {
            $event = $in['event'] ?? null;
            if (!is_string($event) || !preg_match(self::CODE, $event)) {
                return null;
            }
        }
        // Cause of the event, only if the app knows one; a heartbeat has none.
        $detail = $in['detail'] ?? null;
        if ($detail !== null && ($kind !== 'event' || !is_string($detail) || !preg_match(self::CAUSE, $detail))) {
            return null;
        }
        $key = $in['key'] ?? null;
        if ($key !== null && (!is_string($key) || !preg_match('/^[0-9a-f]{64}$/D', $key))) {
            return null;
        }

        $checks = self::checks($in['checks'] ?? null);
        $errors = self::errors($in['errors'] ?? null);
        // Older app versions send no causes: missing counts as none, invalid ones refuse the report like invalid errors.
        $details = isset($in['details']) ? self::details($in['details']) : [];
        $features = self::features($in['features'] ?? null);
        $cron = is_array($in['cron'] ?? null) ? $in['cron'] : [];
        $cronKind = $cron['kind'] ?? null;
        if ($checks === null || $errors === null || $details === null || $features === null || !is_string($cronKind) || !in_array($cronKind, self::CRON_KINDS, true)) {
            return null;
        }

        return $base + [
            'installation' => $installation,
            'kind' => $kind,
            'event' => $event,
            'checks' => $checks,
            'errors' => $errors,
            'details' => $details,
            'detail' => $detail,
            'cron_kind' => $cronKind,
            'cron_last' => self::time($cron['last'] ?? null, $now),
            'features' => $features,
            // Maintenance mode (Kompanie-App-Template#42): true only, the reason is never sent.
            'maintenance' => (int)(($in['maintenance'] ?? false) === true),
            'sent' => $sent,
            'nonce' => $nonce,
            'key' => $key,
        ];
    }

    /**
     * Traffic lights: key → level, only simple keys and known levels.
     *
     * @return array<string, string>|null
     */
    private static function checks(mixed $value): ?array
    {
        if (!self::isObject($value, self::MAX_CHECKS)) {
            return null;
        }
        $out = [];
        foreach ($value as $key => $level) {
            if (!is_string($key) || !preg_match('/^[a-z][a-z0-9_]{0,31}$/D', $key) || !is_string($level) || !in_array($level, self::LEVELS, true)) {
                return null;
            }
            $out[$key] = $level;
        }

        return $out;
    }

    /**
     * Error codes of the last 24 hours with their counts.
     *
     * @return array<string, int>|null
     */
    private static function errors(mixed $value): ?array
    {
        if (!self::isObject($value, self::MAX_ERRORS)) {
            return null;
        }
        $out = [];
        foreach ($value as $code => $count) {
            if (!is_string($code) || !preg_match(self::CODE, $code) || !is_int($count) || $count <= 0 || $count > 1000000) {
                return null;
            }
            $out[$code] = $count;
        }

        return $out;
    }

    /**
     * Causes per error code of the last 24 hours with their counts. A code without causes is dropped.
     *
     * @return array<string, array<string, int>>|null
     */
    private static function details(mixed $value): ?array
    {
        if (!self::isObject($value, self::MAX_ERRORS)) {
            return null;
        }
        $out = [];
        foreach ($value as $code => $causes) {
            if (!is_string($code) || !preg_match(self::CODE, $code) || !self::isObject($causes, self::MAX_CAUSES)) {
                return null;
            }
            foreach ($causes as $cause => $count) {
                if (!is_string($cause) || !preg_match(self::CAUSE, $cause) || !is_int($count) || $count <= 0 || $count > 1000000) {
                    return null;
                }
                $out[$code][$cause] = $count;
            }
        }

        return $out;
    }

    /**
     * Enabled areas, keys only.
     *
     * @return list<string>|null
     */
    private static function features(mixed $value): ?array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > self::MAX_FEATURES) {
            return null;
        }
        $out = [];
        foreach ($value as $feature) {
            if (!is_string($feature) || !preg_match('/^[a-z]{1,20}$/D', $feature)) {
                return null;
            }
            $out[] = $feature;
        }

        return $out;
    }

    /**
     * A JSON object with at most $max entries (an empty object decodes to an empty array).
     *
     * @phpstan-assert-if-true array<mixed> $value
     */
    private static function isObject(mixed $value, int $max): bool
    {
        return is_array($value) && count($value) <= $max && ($value === [] || !array_is_list($value));
    }

    /**
     * A Unix timestamp from the report as UTC DATETIME, or null if it is implausible.
     */
    private static function time(mixed $value, int $now): ?string
    {
        if (!is_int($value) || $value < self::MIN_TIMESTAMP || $value > $now + self::MAX_SKEW) {
            return null;
        }

        return gmdate('Y-m-d H:i:s', $value);
    }
}
