<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Releases\ReleaseRun;
use Cockpit\Releases\ReleaseStore;

/**
 * Release runs in memory, with the same rules as ReleaseRepository, for the webhook and sync tests.
 *
 * @phpstan-import-type Stored from ReleaseStore
 */
final class InMemoryReleaseStore implements ReleaseStore
{
    /** @var array<int, Stored> */
    public array $runs = [];

    public function upsert(array $row): void
    {
        $old = $this->runs[$row['id']] ?? null;
        if ($old === null) {
            $this->runs[$row['id']] = $row + ['core_version' => null];

            return;
        }
        if ($row['updated_at'] >= $old['updated_at']) {
            $old['status'] = $row['status'];
            $old['conclusion'] = $row['conclusion'];
        }
        $old['publishing'] ??= $row['publishing'];
        $old['title'] = $row['title'] ?? $old['title'];
        $old['updated_at'] = max($old['updated_at'], $row['updated_at']);
        $this->runs[$row['id']] = $old;
    }

    public function markPublishing(int $runId): void
    {
        if (($this->runs[$runId]['workflow'] ?? null) === ReleaseRun::SYNC) {
            $this->runs[$runId]['publishing'] = 1;
        }
    }

    public function setPublishing(int $runId, bool $publishing): void
    {
        if (isset($this->runs[$runId])) {
            $this->runs[$runId]['publishing'] = $publishing ? 1 : 0;
        }
    }

    public function setCoreVersion(int $runId, string $version): void
    {
        if (isset($this->runs[$runId])) {
            $this->runs[$runId]['core_version'] = $version;
        }
    }

    public function pending(string $since, int $limit): array
    {
        $rows = array_filter($this->runs, static fn (array $r): bool => $r['started_at'] >= $since
            && ($r['publishing'] === null || ($r['publishing'] === 1 && $r['core_version'] === null)));

        return array_slice(self::newestFirst($rows), 0, $limit);
    }

    public function find(int $runId): ?array
    {
        return $this->runs[$runId] ?? null;
    }

    public function releases(int $limit): array
    {
        return array_slice(self::newestFirst(array_filter($this->runs, static fn (array $r): bool => $r['publishing'] === 1)), 0, $limit);
    }

    public function prune(string $quiet, string $all): void
    {
        $this->runs = array_filter($this->runs, static fn (array $r): bool => $r['started_at'] >= $all
            && ($r['publishing'] === 1 || $r['started_at'] >= $quiet));
    }

    /**
     * @param array<int, Stored> $rows
     * @return list<Stored>
     */
    private static function newestFirst(array $rows): array
    {
        usort($rows, static fn (array $a, array $b): int => strcmp($b['started_at'], $a['started_at']));

        return $rows;
    }
}
