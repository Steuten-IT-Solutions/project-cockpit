<?php

declare(strict_types=1);

namespace Cockpit\Releases;

/**
 * What the dashboard shows per channel: releases running now, the last successful one and a failed run after it.
 *
 * @phpstan-import-type Stored from ReleaseStore
 * @phpstan-type Channel array{running: list<Stored>, last: ?Stored, failed: ?Stored}
 */
final class ReleaseView
{
    public const CHANNELS = ['early' => 'Early', 'stable' => 'Stable'];

    /**
     * @param list<Stored> $releases from ReleaseStore::releases(), newest first
     * @return array<string, Channel> keyed by channel, in the order of CHANNELS
     */
    public static function summary(array $releases): array
    {
        $summary = [];
        foreach (array_keys(self::CHANNELS) as $channel) {
            $running = [];
            $last = null;
            $failed = null;
            foreach ($releases as $run) {
                if ($run['channel'] !== $channel || $run['publishing'] !== 1) {
                    continue;
                }
                if ($run['status'] !== 'completed') {
                    $running[] = $run;
                } elseif ($run['conclusion'] === 'success') {
                    $last = $run;
                    break;
                } else {
                    $failed ??= $run;
                }
            }
            $summary[$channel] = ['running' => $running, 'last' => $last, 'failed' => $failed];
        }

        return $summary;
    }

    /**
     * German label of a run that did not succeed.
     */
    public static function conclusion(?string $conclusion): string
    {
        return match ($conclusion) {
            'failure', 'startup_failure' => 'fehlgeschlagen',
            'cancelled' => 'abgebrochen',
            'timed_out' => 'Zeit überschritten',
            default => 'beendet: ' . ($conclusion ?? 'unbekannt'),
        };
    }
}
