<?php

declare(strict_types=1);

namespace Cockpit\Releases;

/**
 * Storage of release runs; ReleaseRepository in production, an in-memory store in the tests.
 *
 * @phpstan-import-type Row from ReleaseRun
 * @phpstan-type Stored array{
 *     id: int, workflow: string, channel: string, branch: string, event: string, status: string,
 *     conclusion: ?string, publishing: ?int, title: ?string, head_sha: string, html_url: string,
 *     started_at: string, updated_at: string, core_version: ?string
 * }
 */
interface ReleaseStore
{
    /**
     * Inserts or refreshes a run. Status and conclusion change only if the run's updated_at is not older than the
     * stored one (webhooks can arrive out of order); a known publishing flag and core version are kept.
     *
     * @param Row $row
     */
    public function upsert(array $row): void;

    /** A publishing job of this sync run was seen. Unknown runs are ignored. */
    public function markPublishing(int $runId): void;

    public function setPublishing(int $runId, bool $publishing): void;

    public function setCoreVersion(int $runId, string $version): void;

    /**
     * Runs started since $since that still lack data: sync runs whose publishing is unknown, and publishing runs
     * without a core version. Newest first.
     *
     * @return list<Stored>
     */
    public function pending(string $since, int $limit): array;

    /**
     * @return Stored|null
     */
    public function find(int $runId): ?array;

    /**
     * Runs that release (promote runs and publishing sync runs), newest first.
     *
     * @return list<Stored>
     */
    public function releases(int $limit): array;

    /** Removes runs without a release started before $quiet and all runs started before $all. */
    public function prune(string $quiet, string $all): void;
}
