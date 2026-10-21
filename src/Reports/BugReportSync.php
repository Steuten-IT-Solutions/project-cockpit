<?php

declare(strict_types=1);

namespace Cockpit\Reports;

use Cockpit\Config;
use Cockpit\GitHub\Client;
use RuntimeException;

/**
 * Turns stored bug reports into issues of the private reports repository (cron, and right after a report arrived).
 *
 * GitHub's REST API cannot attach files to issues, so a screenshot is committed to the same private repository
 * (screenshots/YYYY/MM/<report id>.<ext>) and shown in the issue from there: only people with access to the repository
 * can open it. The installation token is limited to that repository with issues and contents write.
 *
 * A failure keeps the report for the next run (GitHub down, missing permission); a network error or 5xx stops the
 * run. Reports are given up after BugReportRepository::KEEP_PENDING_DAYS.
 *
 * @phpstan-import-type Pending from BugReportStore
 * @phpstan-import-type Fields from BugReport
 */
final class BugReportSync
{
    private const LABEL_COLOR = 'd93f0b';

    /** @var array<string, true> labels known to exist in this run */
    private array $labels = [];

    public function __construct(
        private readonly Client $client,
        private readonly BugReportStore $store,
        private readonly string $repo,
        private readonly string $labelPrefix,
        private readonly string $timezone,
    ) {
    }

    /**
     * From config.php: the app of the bug_reports section if it names one, else the app of the github section.
     * Null without a bug_reports section.
     */
    public static function fromConfig(Config $config, BugReportStore $store): ?self
    {
        $reports = $config->bugReports;
        if ($reports === null) {
            return null;
        }
        $clientId = $reports['client_id'] ?? $config->github['client_id'] ?? null;
        $keyFile = $reports['private_key_file'] ?? $config->github['private_key_file'] ?? null;
        if ($clientId === null || $keyFile === null) {
            return null;
        }
        $key = @file_get_contents($keyFile);
        if ($key === false) {
            throw new RuntimeException('Schlüsseldatei der GitHub App für Fehlermeldungen nicht lesbar.');
        }
        $client = new Client($clientId, $key, $config->github['api_base'] ?? 'https://api.github.com');

        return new self($client, $store, $reports['repo'], $reports['label_prefix'], $config->timezone);
    }

    /**
     * @return array{created: int, failed: int, errors: list<string>}
     */
    public function run(int $now, int $limit = 20): array
    {
        if (!$this->store->lock()) {
            return ['created' => 0, 'failed' => 0, 'errors' => []];
        }
        try {
            return $this->runLocked($now, $limit);
        } finally {
            $this->store->unlock();
        }
    }

    /**
     * @return array{created: int, failed: int, errors: list<string>}
     */
    private function runLocked(int $now, int $limit): array
    {
        $pending = $this->store->pending($limit);
        if ($pending === []) {
            return ['created' => 0, 'failed' => 0, 'errors' => []];
        }
        $token = $this->token($now);
        $created = 0;
        $failed = 0;
        $errors = [];
        foreach ($pending as $report) {
            try {
                $this->createIssue($report, $token, $now);
                $created++;
            } catch (RuntimeException $e) {
                $failed++;
                $errors[] = $e->getMessage();
                $this->store->failed($report['id'], $e->getMessage());
                if ($e->getCode() >= 500 || $e->getCode() === 0) {
                    break; // GitHub not reachable: try the rest next time
                }
            }
        }

        return ['created' => $created, 'failed' => $failed, 'errors' => $errors];
    }

    /**
     * Installation token of the reports repository's owner, limited to that repository.
     */
    private function token(int $now): string
    {
        [$owner, $name] = explode('/', $this->repo, 2);
        foreach ($this->client->installations($now) as $installation) {
            if (strcasecmp($installation['account'], $owner) === 0) {
                return $this->client->installationToken($installation['id'], $now, [$name], ['issues' => 'write', 'contents' => 'write', 'metadata' => 'read']);
            }
        }
        throw new RuntimeException(sprintf('Die GitHub App ist nicht bei %s installiert.', $owner));
    }

    /**
     * @param Pending $report
     */
    private function createIssue(array $report, string $token, int $now): void
    {
        $fields = self::fields($report['payload']);
        $base = '/repos/' . implode('/', array_map('rawurlencode', explode('/', $this->repo, 2)));
        $label = BugReport::label($this->labelPrefix, $report['kompanie']);
        $this->ensureLabel($base, $label, $report['kompanie'], $token);

        $screenshotUrl = $report['screenshot_url'];
        if ($screenshotUrl === null && $report['screenshot'] !== null) {
            $screenshotUrl = $this->commitScreenshot($base, $report, $token, $now);
            $this->store->screenshotCommitted($report['id'], $screenshotUrl);
        }

        [$status, $body] = $this->client->send('POST', $base . '/issues', $token, [
            'title' => BugReport::title($fields['description']),
            'body' => BugReport::body($fields, $report['kompanie'], $report['installation_id'], $report['report_id'], $screenshotUrl, $this->timezone),
            'labels' => [$label],
        ]);
        $number = is_array($body) ? ($body['number'] ?? null) : null;
        $url = is_array($body) ? ($body['html_url'] ?? null) : null;
        if ($status !== 201 || !is_int($number) || !is_string($url)) {
            throw self::error('Issue', $status, $body);
        }
        $this->store->done($report['id'], $number, $url, gmdate('Y-m-d H:i:s', $now));
    }

    private function ensureLabel(string $base, string $label, string $kompanie, string $token): void
    {
        if (isset($this->labels[$label])) {
            return;
        }
        [$status, $body] = $this->client->get($base . '/labels/' . rawurlencode($label), $token);
        if ($status === 404) {
            [$status, $body] = $this->client->send('POST', $base . '/labels', $token, [
                'name' => $label,
                'color' => self::LABEL_COLOR,
                'description' => mb_substr('Fehlermeldungen aus der App ' . $kompanie, 0, 100),
            ]);
            // 422: created by a parallel run in the meantime
            if ($status !== 201 && $status !== 422) {
                throw self::error('Label', $status, $body);
            }
        } elseif ($status !== 200) {
            throw self::error('Label', $status, $body);
        }
        $this->labels[$label] = true;
    }

    /**
     * @param Pending $report
     * @return string address of the file on GitHub (html_url)
     */
    private function commitScreenshot(string $base, array $report, string $token, int $now): string
    {
        $ext = BugReport::TYPES[(string)$report['screenshot_type']] ?? 'png';
        $path = 'screenshots/' . gmdate('Y/m', $now) . '/' . $report['report_id'] . '.' . $ext;
        [$status, $body] = $this->client->send('PUT', $base . '/contents/' . $path, $token, [
            'message' => 'Add screenshot of bug report ' . $report['report_id'],
            'content' => base64_encode((string)$report['screenshot']),
        ]);
        if ($status === 422) {
            // Committed by an earlier, interrupted attempt: use the existing file.
            [$status, $body] = $this->client->get($base . '/contents/' . $path, $token);
            $url = is_array($body) ? ($body['html_url'] ?? null) : null;
        } else {
            $url = is_array($body) && is_array($body['content'] ?? null) ? ($body['content']['html_url'] ?? null) : null;
        }
        if (($status !== 200 && $status !== 201) || !is_string($url) || !str_starts_with($url, 'https://')) {
            throw self::error('Bildschirmfoto', $status, $body);
        }

        return $url;
    }

    /**
     * @return Fields
     */
    private static function fields(string $payload): array
    {
        $f = json_decode($payload, true);
        $f = is_array($f) ? $f : [];
        $opt = static function (string $k) use ($f): ?string {
            $v = $f[$k] ?? null;

            return is_string($v) ? $v : null;
        };
        $str = static fn (string $k): string => $opt($k) ?? '';
        $created = $f['created'] ?? null;

        return [
            'description' => $str('description') === '' ? '(ohne Beschreibung)' : $str('description'),
            'expected' => $str('expected'),
            'page' => $str('page'),
            'version' => $str('version'),
            'variant' => $str('variant'),
            'userAgent' => $str('userAgent'),
            'role' => $str('role'),
            'name' => $opt('name'),
            'lastError' => $opt('lastError'),
            'created' => is_int($created) ? $created : 0,
        ];
    }

    /**
     * Shown in the cron status (German) and stored with the report; the code is the HTTP status.
     */
    private static function error(string $what, int $status, mixed $body): RuntimeException
    {
        return new RuntimeException(sprintf('%s: GitHub antwortete %d%s', $what, $status, Client::reason($body)), $status);
    }
}
