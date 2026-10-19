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
     * Counts one report in the given UTC hour (YYYYMMDDHH) and returns the hour's total so far.
     */
    public function countInHour(string $hour, string $dayAgo): int;

    /**
     * Remembers the nonce of an accepted report; false if it was seen before (replay).
     */
    public function claimNonce(string $installation, string $nonce, string $now): bool;

    /**
     * Stores a new installation with its encrypted secret (trust on first use).
     *
     * @param Format2 $report
     */
    public function register(array $report, string $secretEnc, string $now): void;

    /**
     * Stores the state of a report and appends it to the history (heartbeat or event).
     *
     * @param Format2 $report
     */
    public function record(array $report, string $now): void;
}
