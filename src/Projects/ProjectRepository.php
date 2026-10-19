<?php

declare(strict_types=1);

namespace Cockpit\Projects;

use PDO;

/**
 * @phpstan-type Project array{
 *     id: int, full_name: string, owner: string, name: string, description: ?string, html_url: string,
 *     is_private: bool, is_archived: bool, is_fork: bool, default_branch: string, pushed_at: ?string,
 *     open_issues: int, open_prs: int, release_tag: ?string, release_url: ?string, release_at: ?string,
 *     ci_status: ?string, ci_conclusion: ?string, ci_url: ?string, ci_at: ?string, ci_workflow: ?string,
 *     sync_error: ?string, synced_at: string, available: bool, hidden: bool, has_note: bool
 * }
 */
final class ProjectRepository
{
    private const COLUMNS = [
        'id', 'full_name', 'owner', 'name', 'description', 'html_url', 'is_private', 'is_archived', 'is_fork',
        'default_branch', 'pushed_at', 'open_issues', 'open_prs', 'release_tag', 'release_url', 'release_at',
        'ci_status', 'ci_conclusion', 'ci_url', 'ci_at', 'ci_workflow', 'synced_at',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Inserts or refreshes a project. hidden and notes are owned by the user and never touched here.
     *
     * @param array<string, int|string|null> $row from RepoSnapshot::row()
     */
    public function upsert(array $row): void
    {
        $values = [];
        foreach (self::COLUMNS as $column) {
            $values[] = $row[$column] ?? null;
        }
        $updates = implode(', ', array_map(
            static fn (string $c): string => $c . ' = VALUES(' . $c . ')',
            array_slice(self::COLUMNS, 1),
        ));

        $this->pdo->prepare(
            'INSERT INTO projects (' . implode(', ', self::COLUMNS) . ', available, sync_error) VALUES ('
            . implode(', ', array_fill(0, count(self::COLUMNS), '?')) . ', 1, NULL) '
            . 'ON DUPLICATE KEY UPDATE ' . $updates . ', available = 1, sync_error = NULL'
        )->execute($values);
    }

    public function markError(int $id, string $message): void
    {
        $this->pdo->prepare('UPDATE projects SET sync_error = ? WHERE id = ?')->execute([$message, $id]);
    }

    /**
     * Repositories no longer granted to the app stay in the table (their notes survive)
     * but are flagged, so the dashboard can leave them out.
     *
     * @param list<int> $ids
     */
    public function markUnavailableExcept(array $ids): void
    {
        if ($ids === []) {
            $this->pdo->prepare('UPDATE projects SET available = 0')->execute();

            return;
        }
        $this->pdo->prepare(
            'UPDATE projects SET available = 0 WHERE id NOT IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')'
        )->execute($ids);
    }

    /**
     * @return list<Project>
     */
    public function all(): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT p.*, EXISTS (SELECT 1 FROM project_notes n WHERE n.project_id = p.id) AS has_note
             FROM projects p WHERE p.available = 1
             ORDER BY p.pushed_at IS NULL, p.pushed_at DESC, p.full_name'
        );
        $stmt->execute();

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    /**
     * @return Project|null
     */
    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT p.*, EXISTS (SELECT 1 FROM project_notes n WHERE n.project_id = p.id) AS has_note
             FROM projects p WHERE p.id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return is_array($row) ? self::hydrate($row) : null;
    }

    public function setHidden(int $id, bool $hidden): void
    {
        $this->pdo->prepare('UPDATE projects SET hidden = ? WHERE id = ?')->execute([$hidden ? 1 : 0, $id]);
    }

    public function lastSync(): ?string
    {
        $stmt = $this->pdo->prepare('SELECT MAX(synced_at) FROM projects');
        $stmt->execute();
        $value = $stmt->fetchColumn();

        return is_string($value) ? $value : null;
    }

    /**
     * @param array<string, mixed> $row
     * @return Project
     */
    private static function hydrate(array $row): array
    {
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;

        return [
            'id' => (int)$row['id'],
            'full_name' => (string)$row['full_name'],
            'owner' => (string)$row['owner'],
            'name' => (string)$row['name'],
            'description' => $str('description'),
            'html_url' => (string)$row['html_url'],
            'is_private' => (bool)$row['is_private'],
            'is_archived' => (bool)$row['is_archived'],
            'is_fork' => (bool)$row['is_fork'],
            'default_branch' => (string)$row['default_branch'],
            'pushed_at' => $str('pushed_at'),
            'open_issues' => (int)$row['open_issues'],
            'open_prs' => (int)$row['open_prs'],
            'release_tag' => $str('release_tag'),
            'release_url' => $str('release_url'),
            'release_at' => $str('release_at'),
            'ci_status' => $str('ci_status'),
            'ci_conclusion' => $str('ci_conclusion'),
            'ci_url' => $str('ci_url'),
            'ci_at' => $str('ci_at'),
            'ci_workflow' => $str('ci_workflow'),
            'sync_error' => $str('sync_error'),
            'synced_at' => (string)$row['synced_at'],
            'available' => (bool)$row['available'],
            'hidden' => (bool)$row['hidden'],
            'has_note' => (bool)$row['has_note'],
        ];
    }
}
