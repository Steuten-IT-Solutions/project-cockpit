<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Reports\BugReportStore;

/**
 * Bug report storage in memory, for the receiver and sync tests.
 *
 * @phpstan-import-type Incoming from \Cockpit\Reports\BugReport
 * @phpstan-import-type Pending from BugReportStore
 */
final class InMemoryBugReportStore implements BugReportStore
{
    /** @var array<string, array{kompanie: string, secret_enc: string}> secrets from status reports */
    public array $statusSecrets = [];
    /** @var array<string, array{kompanie: string, secret_enc: string}> secrets learned from bug reports */
    public array $reportSecrets = [];
    /** @var list<string> companies with a project card; empty: every company counts as known */
    public array $companies = [];
    /** @var array<string, int> */
    public array $counts = [];
    /** @var array<string, true> */
    public array $nonces = [];
    /** @var array<int, array{report: Incoming, screenshot_url: ?string, issue: ?string, attempts: int, error: ?string}> */
    public array $reports = [];

    public function secretFor(string $installation): ?array
    {
        return $this->statusSecrets[$installation] ?? $this->reportSecrets[$installation] ?? null;
    }

    public function registerSecret(string $installation, string $kompanie, string $secretEnc, string $now): bool
    {
        if (isset($this->reportSecrets[$installation])) {
            return false;
        }
        $this->reportSecrets[$installation] = ['kompanie' => $kompanie, 'secret_enc' => $secretEnc];

        return true;
    }

    public function companyKnown(string $kompanie): bool
    {
        return $this->companies === [] || in_array(strtolower($kompanie), array_map('strtolower', $this->companies), true);
    }

    public function hit(string $bucket, string $hour): int
    {
        return $this->counts[$bucket . '|' . $hour] = ($this->counts[$bucket . '|' . $hour] ?? 0) + 1;
    }

    public function claimNonce(string $installation, string $nonce, string $now): bool
    {
        if (isset($this->nonces[$installation . $nonce])) {
            return false;
        }
        $this->nonces[$installation . $nonce] = true;

        return true;
    }

    public function exists(string $installation, string $reportId): bool
    {
        foreach ($this->reports as $r) {
            if ($r['report']['installation'] === $installation && $r['report']['report_id'] === $reportId) {
                return true;
            }
        }

        return false;
    }

    public function store(array $report, string $now): void
    {
        $this->reports[count($this->reports) + 1] = ['report' => $report, 'screenshot_url' => null, 'issue' => null, 'attempts' => 0, 'error' => null];
    }

    public function pending(int $limit): array
    {
        $out = [];
        foreach ($this->reports as $id => $r) {
            if ($r['issue'] === null && count($out) < $limit) {
                $out[] = [
                    'id' => $id,
                    'installation_id' => $r['report']['installation'],
                    'report_id' => $r['report']['report_id'],
                    'kompanie' => $r['report']['kompanie'],
                    'payload' => (string)json_encode($r['report']['fields']),
                    'screenshot' => $r['screenshot_url'] === null ? $r['report']['screenshot'] : null,
                    'screenshot_type' => $r['report']['screenshot_type'],
                    'screenshot_url' => $r['screenshot_url'],
                    'attempts' => $r['attempts'],
                ];
            }
        }

        return $out;
    }

    public function screenshotCommitted(int $id, string $url): void
    {
        $this->reports[$id]['screenshot_url'] = $url;
    }

    public function done(int $id, int $issueNumber, string $issueUrl, string $now): void
    {
        $this->reports[$id]['issue'] = $issueUrl;
    }

    public function failed(int $id, string $error): void
    {
        $this->reports[$id]['attempts']++;
        $this->reports[$id]['error'] = $error;
    }

    public bool $locked = false;

    public function lock(): bool
    {
        if ($this->locked) {
            return false;
        }

        return $this->locked = true;
    }

    public function unlock(): void
    {
        $this->locked = false;
    }
}
