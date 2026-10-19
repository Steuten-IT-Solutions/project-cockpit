<?php

declare(strict_types=1);

namespace Cockpit\Status;

use PDO;

/**
 * @phpstan-import-type StatusRow from StatusReport
 * @phpstan-type StoredReport array{
 *     kompanie: string, variant: string, version: string, php: string, db_driver: string,
 *     update_ok: ?bool, update_at: ?string, update_to: ?string, update_check_ok: bool,
 *     gallery_ok: ?bool, gallery_at: ?string, sent_at: ?string, received_at: string
 * }
 */
final class StatusRepository
{
    private const COLUMNS = [
        'kompanie', 'variant', 'version', 'php', 'db_driver', 'update_ok', 'update_at', 'update_to',
        'update_check_ok', 'gallery_ok', 'gallery_at', 'sent_at',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Counts one report in the given hour and returns the hour's total so far.
     * Counters older than a day are removed on the way.
     */
    public function countInHour(string $hour, string $dayAgo): int
    {
        $this->pdo->prepare('INSERT INTO status_report_hours (hour, received) VALUES (?, 1) ON DUPLICATE KEY UPDATE received = received + 1')
            ->execute([$hour]);
        $this->pdo->prepare('DELETE FROM status_report_hours WHERE hour < ?')->execute([$dayAgo]);
        $stmt = $this->pdo->prepare('SELECT received FROM status_report_hours WHERE hour = ?');
        $stmt->execute([$hour]);

        return (int)$stmt->fetchColumn();
    }

    /**
     * Removes reports not renewed since the cutoff (UTC), e.g. after consent was withdrawn.
     */
    public function pruneBefore(string $cutoff): void
    {
        $this->pdo->prepare('DELETE FROM status_reports WHERE received_at < ?')->execute([$cutoff]);
    }

    public function exists(string $kompanie, string $variant): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM status_reports WHERE kompanie = ? AND variant = ?');
        $stmt->execute([$kompanie, $variant]);

        return $stmt->fetchColumn() !== false;
    }

    public function count(): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM status_reports');
        $stmt->execute();

        return (int)$stmt->fetchColumn();
    }

    /**
     * @param StatusRow $row
     */
    public function save(array $row, string $receivedAt): void
    {
        $values = [];
        foreach (self::COLUMNS as $column) {
            $values[] = $row[$column];
        }
        $values[] = $receivedAt;
        $updates = implode(', ', array_map(
            static fn (string $c): string => $c . ' = VALUES(' . $c . ')',
            [...array_slice(self::COLUMNS, 2), 'received_at'],
        ));
        $this->pdo->prepare(
            'INSERT INTO status_reports (' . implode(', ', self::COLUMNS) . ', received_at) VALUES ('
            . implode(', ', array_fill(0, count(self::COLUMNS) + 1, '?')) . ') ON DUPLICATE KEY UPDATE ' . $updates
        )->execute($values);
    }

    /**
     * @return list<StoredReport>
     */
    public function all(): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM status_reports ORDER BY kompanie, variant');
        $stmt->execute();

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    /**
     * Reports by the GitHub repository of their company (kompanie is "owner/name").
     *
     * @param list<StoredReport> $reports
     * @param list<array{id: int, full_name: string}> $repos
     * @return array<int, list<StoredReport>> GitHub repository id → reports
     */
    public static function byRepository(array $reports, array $repos): array
    {
        $byName = [];
        foreach ($repos as $repo) {
            $byName[strtolower($repo['full_name'])] = $repo['id'];
        }
        $map = [];
        foreach ($reports as $report) {
            $id = $byName[strtolower($report['kompanie'])] ?? null;
            if ($id !== null) {
                $map[$id][] = $report;
            }
        }

        return $map;
    }

    /**
     * @param array<string, mixed> $row
     * @return StoredReport
     */
    private static function hydrate(array $row): array
    {
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;
        $bool = static fn (string $k): ?bool => isset($row[$k]) ? (bool)$row[$k] : null;

        return [
            'kompanie' => (string)$row['kompanie'],
            'variant' => (string)$row['variant'],
            'version' => (string)$row['version'],
            'php' => (string)$row['php'],
            'db_driver' => (string)$row['db_driver'],
            'update_ok' => $bool('update_ok'),
            'update_at' => $str('update_at'),
            'update_to' => $str('update_to'),
            'update_check_ok' => (bool)$row['update_check_ok'],
            'gallery_ok' => $bool('gallery_ok'),
            'gallery_at' => $str('gallery_at'),
            'sent_at' => $str('sent_at'),
            'received_at' => (string)$row['received_at'],
        ];
    }
}
