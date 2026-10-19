<?php

declare(strict_types=1);

namespace Cockpit\Status;

use PDO;

/**
 * Alerts of the status reports (migration 0006). An alert is open while resolved_at is NULL.
 *
 * @phpstan-import-type Wanted from AlertRules
 * @phpstan-type Alert array{
 *     id: int, installation_id: ?string, kompanie: string, variant: ?string, alert_key: string, detail: string,
 *     opened_at: string, last_seen_at: string, notified_at: ?string, resolved_at: ?string, resolved_notified_at: ?string
 * }
 */
final class AlertRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return list<Alert>
     */
    public function open(): array
    {
        return $this->select('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY opened_at DESC, id DESC', []);
    }

    /**
     * Open alerts and those resolved since the cutoff (UTC), newest first.
     *
     * @return list<Alert>
     */
    public function recent(string $cutoff, int $limit): array
    {
        return $this->select('SELECT * FROM alerts WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY opened_at DESC, id DESC LIMIT ' . $limit, [$cutoff]);
    }

    /**
     * @return list<Alert>
     */
    public function forInstallation(string $id, int $limit): array
    {
        return $this->select('SELECT * FROM alerts WHERE installation_id = ? ORDER BY opened_at DESC, id DESC LIMIT ' . $limit, [$id]);
    }

    /**
     * @param Wanted $alert
     */
    public function openAlert(array $alert, string $now): void
    {
        $this->pdo->prepare('INSERT INTO alerts (installation_id, kompanie, variant, alert_key, detail, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$alert['installation_id'], $alert['kompanie'], $alert['variant'], $alert['alert_key'], $alert['detail'], $now, $now]);
    }

    public function touch(int $id, string $detail, string $now): void
    {
        $this->pdo->prepare('UPDATE alerts SET last_seen_at = ?, detail = ? WHERE id = ?')->execute([$now, $detail, $id]);
    }

    public function resolve(int $id, string $now): void
    {
        $this->pdo->prepare('UPDATE alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL')->execute([$now, $id]);
    }

    /**
     * Alerts whose opening or resolution has not been notified yet.
     *
     * @return list<Alert>
     */
    public function unnotified(): array
    {
        return $this->select(
            'SELECT * FROM alerts WHERE notified_at IS NULL OR (resolved_at IS NOT NULL AND resolved_notified_at IS NULL) ORDER BY opened_at, id',
            [],
        );
    }

    /**
     * @param list<int> $ids
     */
    public function markNotified(array $ids, string $now): void
    {
        if ($ids === []) {
            return;
        }
        $in = implode(', ', array_fill(0, count($ids), '?'));
        $this->pdo->prepare('UPDATE alerts SET notified_at = COALESCE(notified_at, ?) WHERE id IN (' . $in . ')')->execute([$now, ...$ids]);
        $this->pdo->prepare('UPDATE alerts SET resolved_notified_at = ? WHERE resolved_at IS NOT NULL AND resolved_notified_at IS NULL AND id IN (' . $in . ')')
            ->execute([$now, ...$ids]);
    }

    /**
     * Removes resolved alerts older than the cutoff (UTC).
     */
    public function prune(string $cutoff): void
    {
        $this->pdo->prepare('DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < ?')->execute([$cutoff]);
    }

    /**
     * @param list<mixed> $params
     * @return list<Alert>
     */
    private function select(string $sql, array $params): array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $str = static fn (string $k): ?string => isset($r[$k]) ? (string)$r[$k] : null;
            $out[] = [
                'id' => (int)$r['id'],
                'installation_id' => $str('installation_id'),
                'kompanie' => (string)$r['kompanie'],
                'variant' => $str('variant'),
                'alert_key' => (string)$r['alert_key'],
                'detail' => (string)$r['detail'],
                'opened_at' => (string)$r['opened_at'],
                'last_seen_at' => (string)$r['last_seen_at'],
                'notified_at' => $str('notified_at'),
                'resolved_at' => $str('resolved_at'),
                'resolved_notified_at' => $str('resolved_notified_at'),
            ];
        }

        return $out;
    }
}
