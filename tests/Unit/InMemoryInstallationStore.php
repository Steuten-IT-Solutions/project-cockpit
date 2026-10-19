<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Status\InstallationStore;

/**
 * Format 2 storage in memory, for the receiver tests.
 *
 * @phpstan-import-type Format2 from \Cockpit\Status\StatusReport
 */
class InMemoryInstallationStore implements InstallationStore
{
    /** @var array<string, array{kompanie: string, variant: string, secret_enc: string}> */
    public array $installations = [];
    /** @var array<string, true> */
    public array $nonces = [];
    /** @var list<Format2> */
    public array $records = [];

    public function find(string $id): ?array
    {
        return $this->installations[$id] ?? null;
    }

    public function count(): int
    {
        return count($this->installations);
    }

    /** @var list<string> companies with a project card; empty: every company counts as known */
    public array $companies = [];

    public function companyKnown(string $kompanie): bool
    {
        return $this->companies === [] || in_array(strtolower($kompanie), array_map('strtolower', $this->companies), true);
    }

    public function countInHour(string $hour, string $dayAgo): int
    {
        return 1;
    }

    public function claimNonce(string $installation, string $nonce, string $now): bool
    {
        if (isset($this->nonces[$installation . $nonce])) {
            return false;
        }
        $this->nonces[$installation . $nonce] = true;

        return true;
    }

    public function register(array $report, string $secretEnc, string $now): bool
    {
        if (isset($this->installations[$report['installation']])) {
            return false;
        }
        $this->installations[$report['installation']] = ['kompanie' => $report['kompanie'], 'variant' => $report['variant'], 'secret_enc' => $secretEnc];

        return true;
    }

    public function record(array $report, string $now): void
    {
        $this->records[] = $report;
    }
}
