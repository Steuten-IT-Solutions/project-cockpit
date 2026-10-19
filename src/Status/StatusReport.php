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
 */
final class StatusReport
{
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
