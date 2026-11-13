<?php

declare(strict_types=1);

namespace Cockpit\Status;

use PDO;

/**
 * Format 2 and 3 status reports in MySQL (migrations 0006, 0011): installations, history, nonces, usage figures.
 *
 * @phpstan-import-type Format2 from StatusReport
 * @phpstan-import-type Usage from StatusReport
 * @phpstan-type UsageDay array{day: string, users: int, d1: int, d7: int, d30: int}
 * @phpstan-type Installation array{
 *     id: string, kompanie: string, variant: string, version: string, php: string, db_driver: string,
 *     cron_kind: string, cron_last: ?string, checks: array<string, string>, errors: array<string, int>,
 *     details: array<string, array<string, int>>, features: list<string>, update_ok: ?bool, update_at: ?string, update_to: ?string, update_check_ok: bool,
 *     gallery_ok: ?bool, gallery_at: ?string, maintenance: bool, first_seen: string, last_seen: string, last_heartbeat: ?string
 * }
 * @phpstan-type HistoryEntry array{type: string, received_at: string, version: string, code: ?string, detail: ?string,
 *     checks: array<string, string>, errors: array<string, int>, details: array<string, array<string, int>>}
 */
final class InstallationRepository implements InstallationStore
{
    /** Daily usage figures are kept this long, so a period can be compared with the year before. */
    public const USAGE_KEEP_DAYS = 400;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function find(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT kompanie, variant, secret_enc FROM installations WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return is_array($row) ? ['kompanie' => (string)$row['kompanie'], 'variant' => (string)$row['variant'], 'secret_enc' => (string)$row['secret_enc']] : null;
    }

    public function count(): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM installations');
        $stmt->execute();

        return (int)$stmt->fetchColumn();
    }

    public function companyKnown(string $kompanie): bool
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) AS projects, SUM(LOWER(full_name) = LOWER(?)) AS matching FROM projects');
        $stmt->execute([$kompanie]);
        $row = $stmt->fetch();

        return !is_array($row) || (int)$row['projects'] === 0 || (int)$row['matching'] > 0;
    }

    public function countInHour(string $hour, string $dayAgo): int
    {
        // Shares the hourly counter with format 1 reports.
        return (new StatusRepository($this->pdo))->countInHour($hour, $dayAgo);
    }

    public function claimNonce(string $installation, string $nonce, string $now): bool
    {
        $stmt = $this->pdo->prepare('INSERT IGNORE INTO status_nonces (installation_id, nonce, received_at) VALUES (?, ?, ?)');
        $stmt->execute([$installation, $nonce, $now]);

        return $stmt->rowCount() === 1;
    }

    public function register(array $report, string $secretEnc, string $now): bool
    {
        $stmt = $this->pdo->prepare(
            'INSERT IGNORE INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, details, features,
                update_check_ok, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $report['installation'], $report['kompanie'], $report['variant'], $secretEnc, $report['version'], $report['php'],
            $report['db_driver'], $report['cron_kind'], '{}', '{}', '{}', '', $report['update_check_ok'], $now, $now,
        ]);

        return $stmt->rowCount() === 1;
    }

    public function record(array $report, string $now): void
    {
        $checks = self::json($report['checks']);
        $errors = self::json($report['errors']);
        $details = self::json($report['details']);
        $heartbeat = $report['kind'] === 'heartbeat';
        $this->pdo->prepare(
            'UPDATE installations SET kompanie = ?, variant = ?, version = ?, php = ?, db_driver = ?, cron_kind = ?, cron_last = ?, checks = ?, errors = ?, details = ?,
                features = ?, update_ok = ?, update_at = ?, update_to = ?, update_check_ok = ?, gallery_ok = ?, gallery_at = ?,
                maintenance = ?, last_seen = ?' . ($heartbeat ? ', last_heartbeat = ?' : '') . ' WHERE id = ?'
        )->execute([
            $report['kompanie'], $report['variant'], $report['version'], $report['php'], $report['db_driver'], $report['cron_kind'], $report['cron_last'], $checks, $errors, $details,
            implode(',', $report['features']), $report['update_ok'], $report['update_at'], $report['update_to'],
            $report['update_check_ok'], $report['gallery_ok'], $report['gallery_at'], $report['maintenance'], $now,
            ...($heartbeat ? [$now, $report['installation']] : [$report['installation']]),
        ]);
        if ($heartbeat) {
            $this->pdo->prepare('INSERT INTO status_heartbeats (installation_id, received_at, version, checks, errors, details, cron_kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$report['installation'], $now, $report['version'], $checks, $errors, $details, $report['cron_kind']]);
        } else {
            $this->pdo->prepare('INSERT INTO status_events (installation_id, code, detail, version, received_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$report['installation'], (string)$report['event'], $report['detail'], $report['version'], $now]);
        }
        if ($heartbeat && $report['usage'] !== null) {
            try {
                $this->recordUsage($report['installation'], $report['usage'], $now);
            } catch (\PDOException $e) {
                // Until the next cron run has applied migration 0011: the report itself is stored.
                error_log('[cockpit status] usage not stored: ' . $e->getMessage());
            }
        }
    }

    /**
     * Current usage figures at the installation and one row per installation and UTC day (the last heartbeat wins).
     *
     * @param Usage $usage
     */
    private function recordUsage(string $id, array $usage, string $now): void
    {
        $this->pdo->prepare('UPDATE installations SET usage_counts = ? WHERE id = ?')->execute([(string)json_encode($usage, JSON_UNESCAPED_SLASHES), $id]);
        $day = substr($now, 0, 10);
        $this->pdo->prepare('DELETE FROM status_usage WHERE installation_id = ? AND day = ?')->execute([$id, $day]);
        $this->pdo->prepare('INSERT INTO status_usage (installation_id, day, users, d1, d7, d30, areas) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $day, $usage['users'], $usage['d1'], $usage['d7'], $usage['d30'], self::json($usage['areas'])]);
    }

    /**
     * The latest usage figures of an installation, null if it never sent any (older app version, or before migration 0011).
     *
     * @return Usage|null
     */
    public function usage(string $id): ?array
    {
        try {
            $stmt = $this->pdo->prepare('SELECT usage_counts FROM installations WHERE id = ?');
            $stmt->execute([$id]);
            $json = $stmt->fetchColumn();
        } catch (\PDOException) {
            return null;
        }
        $value = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($value) || !is_array($value['areas'] ?? null)) {
            return null;
        }
        /** @var array<string, int> $areas */
        $areas = $value['areas'];

        return ['users' => (int)($value['users'] ?? 0), 'd1' => (int)($value['d1'] ?? 0), 'd7' => (int)($value['d7'] ?? 0), 'd30' => (int)($value['d30'] ?? 0), 'areas' => $areas];
    }

    /**
     * Daily usage figures of an installation from the given UTC day (YYYY-MM-DD), oldest first.
     *
     * @return list<UsageDay>
     */
    public function usageDays(string $id, string $fromDay): array
    {
        try {
            $stmt = $this->pdo->prepare('SELECT day, users, d1, d7, d30 FROM status_usage WHERE installation_id = ? AND day >= ? ORDER BY day');
            $stmt->execute([$id, $fromDay]);
        } catch (\PDOException) {
            return [];
        }

        return array_values(array_map(static fn (array $r): array => [
            'day' => substr((string)$r['day'], 0, 10), 'users' => (int)$r['users'], 'd1' => (int)$r['d1'], 'd7' => (int)$r['d7'], 'd30' => (int)$r['d30'],
        ], $stmt->fetchAll()));
    }

    /**
     * @return list<Installation>
     */
    public function all(): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM installations ORDER BY kompanie, variant, first_seen');
        $stmt->execute();

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    /**
     * @return Installation|null
     */
    public function get(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM installations WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return is_array($row) ? self::hydrate($row) : null;
    }

    /**
     * Events received since the cutoff (UTC), oldest first.
     *
     * @return list<array{installation_id: string, code: string, detail: ?string, version: string, received_at: string}>
     */
    public function eventsSince(string $cutoff): array
    {
        $stmt = $this->pdo->prepare('SELECT installation_id, code, detail, version, received_at FROM status_events WHERE received_at >= ? ORDER BY received_at, id');
        $stmt->execute([$cutoff]);

        return array_values(array_map(static fn (array $r): array => [
            'installation_id' => (string)$r['installation_id'],
            'code' => (string)$r['code'],
            'detail' => isset($r['detail']) ? (string)$r['detail'] : null,
            'version' => (string)$r['version'],
            'received_at' => (string)$r['received_at'],
        ], $stmt->fetchAll()));
    }

    /**
     * Heartbeats and events of one installation since the cutoff, newest first.
     *
     * @return list<HistoryEntry>
     */
    public function history(string $id, string $cutoff, int $limit): array
    {
        $out = [];
        $stmt = $this->pdo->prepare('SELECT received_at, version, checks, errors, details FROM status_heartbeats WHERE installation_id = ? AND received_at >= ? ORDER BY received_at DESC LIMIT ' . $limit);
        $stmt->execute([$id, $cutoff]);
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['type' => 'heartbeat', 'received_at' => (string)$r['received_at'], 'version' => (string)$r['version'], 'code' => null, 'detail' => null,
                'checks' => self::decode((string)$r['checks']), 'errors' => self::decode((string)$r['errors']), 'details' => self::decode((string)$r['details'])];
        }
        $stmt = $this->pdo->prepare('SELECT received_at, version, code, detail FROM status_events WHERE installation_id = ? AND received_at >= ? ORDER BY received_at DESC LIMIT ' . $limit);
        $stmt->execute([$id, $cutoff]);
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['type' => 'event', 'received_at' => (string)$r['received_at'], 'version' => (string)$r['version'], 'code' => (string)$r['code'],
                'detail' => isset($r['detail']) ? (string)$r['detail'] : null, 'checks' => [], 'errors' => [], 'details' => []];
        }
        usort($out, static fn (array $a, array $b): int => strcmp($b['received_at'], $a['received_at']));

        return array_slice($out, 0, $limit);
    }

    /**
     * Removes history, nonces, usage figures and installations older than the cutoffs (UTC).
     */
    public function prune(string $historyCutoff, string $nonceCutoff, ?string $usageCutoff = null): void
    {
        try {
            if ($usageCutoff !== null) {
                $this->pdo->prepare('DELETE FROM status_usage WHERE day < ?')->execute([substr($usageCutoff, 0, 10)]);
            }
            // With the installation, below: otherwise its daily figures would stay behind.
            $this->pdo->prepare('DELETE FROM status_usage WHERE installation_id IN (SELECT id FROM installations WHERE last_seen < ?)')->execute([$historyCutoff]);
        } catch (\PDOException $e) {
            error_log('[cockpit status] usage not pruned: ' . $e->getMessage());
        }
        $this->pdo->prepare('DELETE FROM status_heartbeats WHERE received_at < ?')->execute([$historyCutoff]);
        $this->pdo->prepare('DELETE FROM status_events WHERE received_at < ?')->execute([$historyCutoff]);
        $this->pdo->prepare('DELETE FROM status_nonces WHERE received_at < ?')->execute([$nonceCutoff]);
        // An installation that has not reported for the whole retention period (e.g. consent withdrawn),
        // with its alerts: otherwise the next evaluation would report them as resolved.
        $this->pdo->prepare('DELETE FROM alerts WHERE installation_id IN (SELECT id FROM installations WHERE last_seen < ?)')->execute([$historyCutoff]);
        $this->pdo->prepare('DELETE FROM installations WHERE last_seen < ?')->execute([$historyCutoff]);
    }

    /**
     * @param array<mixed> $value
     */
    private static function json(array $value): string
    {
        return $value === [] ? '{}' : (string)json_encode($value, JSON_UNESCAPED_SLASHES);
    }

    /**
     * @return array<mixed>
     */
    private static function decode(string $json): array
    {
        $value = json_decode($json, true);

        return is_array($value) ? $value : [];
    }

    /**
     * @param array<string, mixed> $row
     * @return Installation
     */
    private static function hydrate(array $row): array
    {
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;
        $bool = static fn (string $k): ?bool => isset($row[$k]) ? (bool)$row[$k] : null;
        /** @var array<string, string> $checks */
        $checks = self::decode((string)$row['checks']);
        /** @var array<string, int> $errors */
        $errors = self::decode((string)$row['errors']);
        /** @var array<string, array<string, int>> $details */
        $details = self::decode((string)($row['details'] ?? ''));
        $features = (string)$row['features'] === '' ? [] : explode(',', (string)$row['features']);

        return [
            'id' => (string)$row['id'],
            'kompanie' => (string)$row['kompanie'],
            'variant' => (string)$row['variant'],
            'version' => (string)$row['version'],
            'php' => (string)$row['php'],
            'db_driver' => (string)$row['db_driver'],
            'cron_kind' => (string)$row['cron_kind'],
            'cron_last' => $str('cron_last'),
            'checks' => $checks,
            'errors' => $errors,
            'details' => $details,
            'features' => $features,
            'update_ok' => $bool('update_ok'),
            'update_at' => $str('update_at'),
            'update_to' => $str('update_to'),
            'update_check_ok' => (bool)$row['update_check_ok'],
            'gallery_ok' => $bool('gallery_ok'),
            'gallery_at' => $str('gallery_at'),
            'maintenance' => (bool)($row['maintenance'] ?? false),
            'first_seen' => (string)$row['first_seen'],
            'last_seen' => (string)$row['last_seen'],
            'last_heartbeat' => $str('last_heartbeat'),
        ];
    }
}
