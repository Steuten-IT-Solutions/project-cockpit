<?php

declare(strict_types=1);

namespace Cockpit\Projects;

/**
 * Display helpers for project cards (German UI text).
 */
final class ProjectView
{
    /**
     * Label and badge class for the latest workflow run on the default branch.
     *
     * @return array{string, string}
     */
    public static function ci(?string $status, ?string $conclusion): array
    {
        if ($status === null) {
            return ['keine CI', 'neutral'];
        }
        if ($status !== 'completed') {
            return ['CI läuft', 'neutral'];
        }

        return match ($conclusion) {
            'success' => ['CI grün', 'ok'],
            'failure', 'timed_out', 'startup_failure' => ['CI rot', 'fail'],
            'cancelled' => ['CI abgebrochen', 'warn'],
            'skipped', 'neutral' => ['CI übersprungen', 'neutral'],
            default => ['CI ' . ($conclusion ?? 'unbekannt'), 'warn'],
        };
    }

    /**
     * Label and badge class for the state of the latest production deployment on Vercel.
     *
     * @return array{string, string}
     */
    public static function vercel(?string $state): array
    {
        return match ($state) {
            'READY' => ['Vercel live', 'ok'],
            'ERROR' => ['Vercel Fehler', 'fail'],
            'BUILDING', 'QUEUED', 'INITIALIZING' => ['Vercel baut', 'neutral'],
            'CANCELED' => ['Vercel abgebrochen', 'warn'],
            'BLOCKED' => ['Vercel blockiert', 'warn'],
            null => ['Vercel: kein Deployment', 'neutral'],
            default => ['Vercel ' . strtolower($state), 'warn'],
        };
    }

    /**
     * Relative age in German, e.g. "vor 3 Tagen", from a UTC timestamp.
     */
    public static function age(?string $utc, int $now): string
    {
        if ($utc === null) {
            return '–';
        }
        $ts = strtotime($utc . ' UTC');
        if ($ts === false) {
            return '–';
        }
        $diff = max(0, $now - $ts);

        return match (true) {
            $diff < 3600 => 'vor ' . max(1, intdiv($diff, 60)) . ' Min.',
            $diff < 86400 => 'vor ' . intdiv($diff, 3600) . ' Std.',
            $diff < 2 * 86400 => 'gestern',
            $diff < 60 * 86400 => 'vor ' . intdiv($diff, 86400) . ' Tagen',
            $diff < 730 * 86400 => 'vor ' . intdiv($diff, 30 * 86400) . ' Monaten',
            default => 'vor ' . intdiv($diff, 365 * 86400) . ' Jahren',
        };
    }
}
