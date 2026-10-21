<?php

declare(strict_types=1);

namespace Cockpit\Reports;

/**
 * Storage of bug reports (BugReportRepository; in tests in memory).
 *
 * @phpstan-import-type Incoming from BugReport
 * @phpstan-type Pending array{
 *     id: int, installation_id: string, report_id: string, kompanie: string, payload: string,
 *     screenshot: ?string, screenshot_type: ?string, screenshot_url: ?string, attempts: int
 * }
 */
interface BugReportStore
{
    /**
     * The stored secret of an installation: from its status reports, else from an earlier bug report.
     *
     * @return array{kompanie: string, secret_enc: string}|null
     */
    public function secretFor(string $installation): ?array;

    /**
     * Stores the secret of an installation that sends no status reports (trust on first use). False if another
     * request stored one in the meantime (then that one decides).
     */
    public function registerSecret(string $installation, string $kompanie, string $secretEnc, string $now): bool;

    /** Same rule as for status reports: only companies with a project card (or no cards synced yet). */
    public function companyKnown(string $kompanie): bool;

    /** Counts one report in the bucket for the UTC hour (YYYYMMDDHH) and returns the count so far. */
    public function hit(string $bucket, string $hour): int;

    /** Remembers the nonce (shared with the status reports); false if seen before. */
    public function claimNonce(string $installation, string $nonce, string $now): bool;

    /** Whether this report (installation and report id) arrived before. */
    public function exists(string $installation, string $reportId): bool;

    /**
     * @param Incoming $report
     */
    public function store(array $report, string $now): void;

    /**
     * Reports without an issue yet, oldest first.
     *
     * @return list<Pending>
     */
    public function pending(int $limit): array;

    public function screenshotCommitted(int $id, string $url): void;

    /** The issue exists: clears payload and screenshot, keeps the row against duplicates. */
    public function done(int $id, int $issueNumber, string $issueUrl, string $now): void;

    public function failed(int $id, string $error): void;

    /** Only one run creates issues at a time (cron and the receiver right after a report); false if taken. */
    public function lock(): bool;

    public function unlock(): void;
}
