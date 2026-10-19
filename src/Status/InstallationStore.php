<?php

declare(strict_types=1);

namespace Cockpit\Status;

/**
 * Storage of format 2 status reports, per installation (InstallationRepository; in tests in memory).
 *
 * @phpstan-import-type Format2 from StatusReport
 */
interface InstallationStore
{
    /**
     * @return array{kompanie: string, variant: string, secret_enc: string}|null
     */
    public function find(string $id): ?array;

    public function count(): int;

    /**
     * Whether the company is one of our repositories (projects from the GitHub sync). Without any
     * synced projects (GitHub App not set up) every company of the organisation counts as known.
     */
    public function companyKnown(string $kompanie): bool;

    /**
     * Counts one report in the given UTC hour (YYYYMMDDHH) and returns the hour's total so far.
     */
    public function countInHour(string $hour, string $dayAgo): int;

    /**
     * Remembers the nonce of an accepted report; false if it was seen before (replay).
     */
    public function claimNonce(string $installation, string $nonce, string $now): bool;

    /**
     * Stores a new installation with its encrypted secret (trust on first use). False if another
     * request registered the same id in the meantime (then the stored secret decides).
     *
     * @param Format2 $report
     */
    public function register(array $report, string $secretEnc, string $now): bool;

    /**
     * Stores the state of a report and appends it to the history (heartbeat or event).
     *
     * @param Format2 $report
     */
    public function record(array $report, string $now): void;
}
