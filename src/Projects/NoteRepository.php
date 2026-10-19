<?php

declare(strict_types=1);

namespace Cockpit\Projects;

use PDO;

/**
 * Notes per project. Every save adds a version; the newest one is the current note,
 * so an accidental overwrite can always be undone.
 */
final class NoteRepository
{
    public const MAX_LENGTH = 100_000;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{body: string, created_at: string}|null
     */
    public function current(int $projectId): ?array
    {
        $versions = $this->history($projectId, 1);

        return $versions[0] ?? null;
    }

    /**
     * @return list<array{id: int, body: string, created_at: string}>
     */
    public function history(int $projectId, int $limit = 20): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, body, created_at FROM project_notes WHERE project_id = ? ORDER BY id DESC LIMIT ' . max(1, min($limit, 100))
        );
        $stmt->execute([$projectId]);

        return array_values(array_map(static fn (array $r): array => [
            'id' => (int)$r['id'],
            'body' => (string)$r['body'],
            'created_at' => (string)$r['created_at'],
        ], $stmt->fetchAll()));
    }

    /**
     * Stores a new version unless the text is unchanged. Returns whether something was saved.
     */
    public function save(int $projectId, string $body, int $userId): bool
    {
        $body = str_replace("\r\n", "\n", $body);
        $current = $this->current($projectId);
        if ($current !== null && $current['body'] === $body) {
            return false;
        }

        $this->pdo->prepare('INSERT INTO project_notes (project_id, body, user_id, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$projectId, $body, $userId, gmdate('Y-m-d H:i:s')]);

        return true;
    }
}
