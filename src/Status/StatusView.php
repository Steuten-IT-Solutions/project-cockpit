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

    /** German labels of the fixed error and event codes (Kompanie-App-Template Telemetry\Code). */
    private const CODES = [
        'UPDATE_FAILED' => 'Update gescheitert',
        'ROLLBACK' => 'Zurückgerollt bzw. Version gewechselt',
        'UPDATE_CHECK' => 'Update-Liste nicht abrufbar',
        'CALENDAR_FETCH' => 'Kalender nicht abrufbar',
        'GALLERY_SYNC' => 'Galerie-Abgleich mit Fehler',
        'GALLERY_403' => 'Galerie: kein Zugriff auf Google Drive',
        'TASK_FAILED' => 'Hintergrundaufgabe abgebrochen',
        'SERVER_ERROR' => 'Interner Fehler bei einer Anfrage',
        'DB_ERROR' => 'Datenbankfehler',
        'PHP_FATAL' => 'Schwerer PHP-Fehler',
        'DISK_LOW' => 'Wenig Speicherplatz',
        'CHECK_ERROR' => 'Ampel auf Rot gesprungen',
    ];

    /** German labels of the traffic lights of an installation (StatusService and health checks). */
    private const CHECKS = [
        'updates' => 'Updates',
        'gallery' => 'Galerie',
        'calendar' => 'Kalender',
        'backup' => 'Datensicherung',
        'server' => 'Server',
        'cron' => 'Hintergrundaufgaben',
        'data' => 'Schutz der Daten',
    ];

    /** German labels of the areas in usage figures (Kompanie-App-Template Features and ActivityService::EXTRA_AREAS). */
    private const AREAS = [
        'app' => 'Allgemein', 'login' => 'Anmeldung', 'events' => 'Termine', 'calendar' => 'Kalender', 'news' => 'News',
        'gallery' => 'Galerie', 'points' => 'Punkte', 'penalties' => 'Strafen', 'ranks' => 'Dienstgrade', 'titles' => 'Titel',
        'attendance' => 'Anwesenheit', 'documents' => 'Dokumente', 'board' => 'Schwarzes Brett', 'polls' => 'Umfragen',
        'birthdays' => 'Geburtstage', 'inventory' => 'Inventar', 'directory' => 'Mitglieder', 'offices' => 'Ämter',
        'lists' => 'Listen', 'mail' => 'E-Mails', 'companies' => 'Kompanien', 'sponsors' => 'Sponsoren', 'pages' => 'Seiten',
    ];

    /** Below this, usage figures are shown as "< 5": in a small company they could point to a single person. */
    public const SMALL_FIGURE = 5;

    /** Unknown areas (added by a later app version) are shown by their key. */
    public static function areaLabel(string $area): string
    {
        return self::AREAS[$area] ?? $area;
    }

    /**
     * A usage figure for display: 1 to 4 as "< 5", otherwise the number.
     */
    public static function figure(int $count): string
    {
        return $count > 0 && $count < self::SMALL_FIGURE ? '< ' . self::SMALL_FIGURE : (string)$count;
    }

    /**
     * Areas of the usage figures, most used first, ties by label.
     *
     * @param array<string, int> $areas
     * @return list<array{label: string, people: string}>
     */
    public static function areas(array $areas): array
    {
        $rows = [];
        foreach ($areas as $key => $people) {
            $rows[] = ['label' => self::areaLabel($key), 'count' => $people];
        }
        usort($rows, static fn (array $a, array $b): int => [$b['count'], $a['label']] <=> [$a['count'], $b['label']]);

        return array_map(static fn (array $r): array => ['label' => $r['label'], 'people' => self::figure($r['count'])], $rows);
    }

    /** Unknown codes are shown as they are. */
    public static function codeLabel(string $code): string
    {
        return self::CODES[$code] ?? $code;
    }

    /**
     * Causes of an error code, most frequent first, e.g. "ics_http_404: 2, ics_timeout: 1" ('' if none).
     *
     * @param array<string, int> $causes
     */
    public static function causes(array $causes): string
    {
        uksort($causes, static fn (string $a, string $b): int => [$causes[$b], $a] <=> [$causes[$a], $b]);

        return implode(', ', array_map(static fn (string $cause, int $count): string => $cause . ': ' . $count, array_keys($causes), $causes));
    }

    public static function checkLabel(string $key): string
    {
        return self::CHECKS[$key] ?? $key;
    }

    public static function cronLabel(string $kind): string
    {
        return match ($kind) {
            'real' => 'Cronjob',
            'pseudo' => 'nur bei Seitenaufrufen',
            'wp' => 'WP-Cron',
            default => $kind,
        };
    }

    /**
     * Traffic light of a format 2 installation: maintenance (an admin locked the app on purpose), error
     * (open alert), warn (yellow light or error codes in the last 24 h) or ok.
     *
     * @param array{checks: array<string, string>, errors: array<string, int>, maintenance?: bool} $installation
     */
    public static function light(array $installation, bool $openAlert): string
    {
        if ($installation['maintenance'] ?? false) {
            return 'maintenance';
        }
        if ($openAlert) {
            return 'error';
        }
        if (in_array('warn', $installation['checks'], true) || $installation['errors'] !== []) {
            return 'warn';
        }

        return 'ok';
    }

    /**
     * German text of an alert key, e.g. "check:gallery" → "Galerie".
     */
    public static function alertLabel(string $key): string
    {
        [$type, $value] = array_pad(explode(':', $key, 2), 2, '');

        return match ($type) {
            'silent' => 'Kein Lebenszeichen',
            'check' => 'Ampel rot: ' . self::checkLabel($value),
            'event' => self::codeLabel($value),
            'release' => 'Fehlerhäufung nach Release ' . $value,
            default => $key,
        };
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
