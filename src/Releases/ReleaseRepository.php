<?php

declare(strict_types=1);

namespace Cockpit\Releases;

use PDO;

/**
 * release_runs in MariaDB.
 *
 * @phpstan-import-type Stored from ReleaseStore
 */
final class ReleaseRepository implements ReleaseStore
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function upsert(array $row): void
    {
        // updated_at is assigned last: MariaDB evaluates the assignments in order, so the conditions before it still
        // see the stored value.
        $newer = 'VALUES(updated_at) >= updated_at';
        $this->pdo->prepare(
            'INSERT INTO release_runs (id, workflow, channel, branch, event, status, conclusion, publishing, title, head_sha,
                html_url, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                status = IF(' . $newer . ', VALUES(status), status),
                conclusion = IF(' . $newer . ', VALUES(conclusion), conclusion),
                publishing = COALESCE(publishing, VALUES(publishing)),
                title = COALESCE(VALUES(title), title),
                updated_at = GREATEST(updated_at, VALUES(updated_at))'
        )->execute([
            $row['id'], $row['workflow'], $row['channel'], $row['branch'], $row['event'], $row['status'],
            $row['conclusion'], $row['publishing'], $row['title'], $row['head_sha'], $row['html_url'],
            $row['started_at'], $row['updated_at'],
        ]);
    }

    public function markPublishing(int $runId): void
    {
        $this->pdo->prepare('UPDATE release_runs SET publishing = 1 WHERE id = ? AND workflow = ?')
            ->execute([$runId, ReleaseRun::SYNC]);
    }

    public function setPublishing(int $runId, bool $publishing): void
    {
        $this->pdo->prepare('UPDATE release_runs SET publishing = ? WHERE id = ?')->execute([$publishing ? 1 : 0, $runId]);
    }

    public function setCoreVersion(int $runId, string $version): void
    {
        $this->pdo->prepare('UPDATE release_runs SET core_version = ? WHERE id = ?')->execute([$version, $runId]);
    }

    public function pending(string $since, int $limit): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM release_runs
             WHERE started_at >= ? AND (publishing IS NULL OR (publishing = 1 AND core_version IS NULL))
             ORDER BY started_at DESC LIMIT ' . max(1, $limit)
        );
        $stmt->execute([$since]);

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    public function find(int $runId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM release_runs WHERE id = ?');
        $stmt->execute([$runId]);
        $row = $stmt->fetch();

        return is_array($row) ? self::hydrate($row) : null;
    }

    public function releases(int $limit): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM release_runs WHERE publishing = 1 ORDER BY started_at DESC LIMIT ' . max(1, $limit));
        $stmt->execute();

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    public function prune(string $quiet, string $all): void
    {
        $this->pdo->prepare('DELETE FROM release_runs WHERE (publishing IS NULL OR publishing = 0) AND started_at < ?')->execute([$quiet]);
        $this->pdo->prepare('DELETE FROM release_runs WHERE started_at < ?')->execute([$all]);
    }

    /**
     * @param array<string, mixed> $row
     * @return Stored
     */
    private static function hydrate(array $row): array
    {
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;

        return [
            'id' => (int)$row['id'],
            'workflow' => (string)$row['workflow'],
            'channel' => (string)$row['channel'],
            'branch' => (string)$row['branch'],
            'event' => (string)$row['event'],
            'status' => (string)$row['status'],
            'conclusion' => $str('conclusion'),
            'publishing' => isset($row['publishing']) ? (int)$row['publishing'] : null,
            'title' => $str('title'),
            'head_sha' => (string)$row['head_sha'],
            'html_url' => (string)$row['html_url'],
            'started_at' => (string)$row['started_at'],
            'updated_at' => (string)$row['updated_at'],
            'core_version' => $str('core_version'),
        ];
    }
}
