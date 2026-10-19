<?php

declare(strict_types=1);

namespace Cockpit\Status;

/**
 * Display helpers for status reports (German UI text).
 *
 * @phpstan-import-type StoredReport from StatusRepository
 */
final class StatusView
{
    /** A report is sent daily; after this long without one the installation counts as silent. */
    public const SILENT_AFTER = 3 * 86400;

    /**
     * What looks wrong with an installation, empty if nothing.
     *
     * @param StoredReport $report
     * @return list<string>
     */
    public static function problems(array $report, int $now): array
    {
        $problems = [];
        $received = strtotime($report['received_at'] . ' UTC');
        if ($received === false || $received < $now - self::SILENT_AFTER) {
            $problems[] = 'seit über 3 Tagen keine Meldung';
        }
        if (!$report['update_check_ok']) {
            $problems[] = 'Update-Liste nicht erreichbar';
        }
        if ($report['update_ok'] === false) {
            $problems[] = 'letztes Update' . ($report['update_to'] !== null ? ' auf ' . $report['update_to'] : '') . ' gescheitert';
        }
        if ($report['gallery_ok'] === false) {
            $problems[] = 'Galerie-Abgleich mit Fehler';
        }

        return $problems;
    }

    /**
     * The release tag if the repository has released a newer version than the one
     * installed (tags are "v" plus the version), else null.
     */
    public static function newerRelease(string $version, ?string $releaseTag): ?string
    {
        if ($releaseTag === null) {
            return null;
        }
        $released = ltrim($releaseTag, 'vV');
        if (!preg_match('/^\d+(\.\d+)+$/D', $released)) {
            return null;
        }

        return version_compare($released, $version, '>') ? $releaseTag : null;
    }

    /**
     * Name of the company without the organisation, e.g. "kompanie-musterstadt".
     */
    public static function name(string $kompanie): string
    {
        $slash = strrpos($kompanie, '/');

        return $slash === false ? $kompanie : substr($kompanie, $slash + 1);
    }

    public static function variant(string $variant): string
    {
        return match ($variant) {
            'wordpress' => 'WordPress',
            'standalone' => 'eigenständig',
            default => $variant,
        };
    }
}
