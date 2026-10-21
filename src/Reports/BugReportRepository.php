<?php

declare(strict_types=1);

namespace Cockpit\Reports;

use Cockpit\Status\InstallationRepository;
use PDO;

/**
 * Bug reports in MySQL (migration 0008): reports, secrets of installations without status reports, rate counters.
 *
 * @phpstan-import-type Pending from BugReportStore
 */
final class BugReportRepository implements BugReportStore
{
    /** Done reports are kept this long (without content) to recognise a report that is sent again. */
    public const KEEP_DONE_DAYS = 30;
    /** Reports without an issue are given up after this long. */
    public const KEEP_PENDING_DAYS = 30;
    private const LOCK = 'cockpit_bug_reports';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function secretFor(string $installation): ?array
    {
        $known = (new InstallationRepository($this->pdo))->find($installation);
        if ($known !== null) {
            return ['kompanie' => $known['kompanie'], 'secret_enc' => $known['secret_enc']];
        }
        $stmt = $this->pdo->prepare('SELECT kompanie, secret_enc FROM report_installations WHERE id = ?');
        $stmt->execute([$installation]);
        $row = $stmt->fetch();

        return is_array($row) ? ['kompanie' => (string)$row['kompanie'], 'secret_enc' => (string)$row['secret_enc']] : null;
    }

    public function registerSecret(string $installation, string $kompanie, string $secretEnc, string $now): bool
    {
        $stmt = $this->pdo->prepare('INSERT IGNORE INTO report_installations (id, kompanie, secret_enc, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$installation, $kompanie, $secretEnc, $now, $now]);

        return $stmt->rowCount() === 1;
    }

    public function companyKnown(string $kompanie): bool
    {
        return (new InstallationRepository($this->pdo))->companyKnown($kompanie);
    }

    public function hit(string $bucket, string $hour): int
    {
        $this->pdo->prepare('INSERT INTO bug_report_counts (bucket, hour, received) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE received = received + 1')
            ->execute([$bucket, $hour]);
        $stmt = $this->pdo->prepare('SELECT received FROM bug_report_counts WHERE bucket = ? AND hour = ?');
        $stmt->execute([$bucket, $hour]);

        return (int)$stmt->fetchColumn();
    }

    public function claimNonce(string $installation, string $nonce, string $now): bool
    {
        return (new InstallationRepository($this->pdo))->claimNonce($installation, $nonce, $now);
    }

    public function exists(string $installation, string $reportId): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM bug_reports WHERE installation_id = ? AND report_id = ?');
        $stmt->execute([$installation, $reportId]);

        return $stmt->fetchColumn() !== false;
    }

    public function store(array $report, string $now): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT IGNORE INTO bug_reports (installation_id, report_id, kompanie, payload, screenshot, screenshot_type, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->bindValue(1, $report['installation']);
        $stmt->bindValue(2, $report['report_id']);
        $stmt->bindValue(3, $report['kompanie']);
        $stmt->bindValue(4, (string)json_encode($report['fields'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $stmt->bindValue(5, $report['screenshot'], $report['screenshot'] === null ? PDO::PARAM_NULL : PDO::PARAM_LOB);
        $stmt->bindValue(6, $report['screenshot_type']);
        $stmt->bindValue(7, $now);
        $stmt->execute();
        $this->pdo->prepare('UPDATE report_installations SET last_seen = ? WHERE id = ?')->execute([$now, $report['installation']]);
    }

    public function pending(int $limit): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, installation_id, report_id, kompanie, payload, screenshot, screenshot_type, screenshot_url, attempts
                FROM bug_reports WHERE done_at IS NULL ORDER BY id LIMIT ' . max(1, $limit)
        );
        $stmt->execute();
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = [
                'id' => (int)$r['id'],
                'installation_id' => (string)$r['installation_id'],
                'report_id' => (string)$r['report_id'],
                'kompanie' => (string)$r['kompanie'],
                'payload' => (string)$r['payload'],
                'screenshot' => isset($r['screenshot']) ? (string)$r['screenshot'] : null,
                'screenshot_type' => isset($r['screenshot_type']) ? (string)$r['screenshot_type'] : null,
                'screenshot_url' => isset($r['screenshot_url']) ? (string)$r['screenshot_url'] : null,
                'attempts' => (int)$r['attempts'],
            ];
        }

        return $out;
    }

    public function screenshotCommitted(int $id, string $url): void
    {
        $this->pdo->prepare('UPDATE bug_reports SET screenshot_url = ?, screenshot = NULL WHERE id = ?')->execute([$url, $id]);
    }

    public function done(int $id, int $issueNumber, string $issueUrl, string $now): void
    {
        $this->pdo->prepare("UPDATE bug_reports SET issue_number = ?, issue_url = ?, done_at = ?, payload = '{}', screenshot = NULL, last_error = NULL WHERE id = ?")
            ->execute([$issueNumber, $issueUrl, $now, $id]);
    }

    public function failed(int $id, string $error): void
    {
        $this->pdo->prepare('UPDATE bug_reports SET attempts = attempts + 1, last_error = ? WHERE id = ?')->execute([mb_substr($error, 0, 255), $id]);
    }

    public function lock(): bool
    {
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql') {
            return true;
        }
        $stmt = $this->pdo->prepare('SELECT GET_LOCK(?, 0)');
        $stmt->execute([self::LOCK]);

        return (int)$stmt->fetchColumn() === 1;
    }

    public function unlock(): void
    {
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([self::LOCK]);
        }
    }

    /**
     * Removes done reports, given-up reports, old counters and secrets of installations that went quiet (UTC).
     */
    public function prune(int $now): void
    {
        $done = gmdate('Y-m-d H:i:s', $now - self::KEEP_DONE_DAYS * 86400);
        $pending = gmdate('Y-m-d H:i:s', $now - self::KEEP_PENDING_DAYS * 86400);
        $this->pdo->prepare('DELETE FROM bug_reports WHERE done_at IS NOT NULL AND done_at < ?')->execute([$done]);
        $this->pdo->prepare('DELETE FROM bug_reports WHERE done_at IS NULL AND received_at < ?')->execute([$pending]);
        $this->pdo->prepare('DELETE FROM bug_report_counts WHERE hour < ?')->execute([gmdate('YmdH', $now - 2 * 86400)]);
        $this->pdo->prepare('DELETE FROM report_installations WHERE last_seen < ?')->execute([gmdate('Y-m-d H:i:s', $now - 365 * 86400)]);
    }
}
