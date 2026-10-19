<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use PDO;

/**
 * @phpstan-type VercelProject array{
 *     id: string, name: string, repo_id: ?int, repo_full_name: ?string, production_domain: ?string,
 *     deploy_state: ?string, deploy_created_at: ?string, deploy_inspector_url: ?string,
 *     deploy_commit: ?string, deploy_error: ?string, synced_at: string
 * }
 */
final class VercelRepository
{
    private const COLUMNS = [
        'id', 'name', 'repo_id', 'repo_full_name', 'production_domain', 'deploy_state', 'deploy_created_at',
        'deploy_inspector_url', 'deploy_commit', 'deploy_error', 'synced_at',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, int|string|null> $row from VercelSnapshot::row()
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
            'INSERT INTO vercel_projects (' . implode(', ', self::COLUMNS) . ', available) VALUES ('
            . implode(', ', array_fill(0, count(self::COLUMNS), '?')) . ', 1) '
            . 'ON DUPLICATE KEY UPDATE ' . $updates . ', available = 1'
        )->execute($values);
    }

    /**
     * @param list<string> $ids
     */
    public function markUnavailableExcept(array $ids): void
    {
        if ($ids === []) {
            $this->pdo->prepare('UPDATE vercel_projects SET available = 0')->execute();

            return;
        }
        $this->pdo->prepare(
            'UPDATE vercel_projects SET available = 0 WHERE id NOT IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')'
        )->execute($ids);
    }

    /**
     * @return list<VercelProject>
     */
    public function all(): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM vercel_projects WHERE available = 1 ORDER BY name');
        $stmt->execute();

        return array_values(array_map(self::hydrate(...), $stmt->fetchAll()));
    }

    /**
     * Vercel projects by the GitHub repository they deploy, matched by repository id,
     * or by owner/name when Vercel did not report an id.
     *
     * @param list<VercelProject> $vercelProjects
     * @param list<array{id: int, full_name: string}> $repos
     * @return array<int, list<VercelProject>> GitHub repository id → Vercel projects
     */
    public static function byRepository(array $vercelProjects, array $repos): array
    {
        $byName = [];
        $known = [];
        foreach ($repos as $repo) {
            $byName[strtolower($repo['full_name'])] = $repo['id'];
            $known[$repo['id']] = true;
        }
        $map = [];
        foreach ($vercelProjects as $project) {
            // An id is only a match if a card exists for it; otherwise try the name.
            $repoId = $project['repo_id'] !== null && isset($known[$project['repo_id']]) ? $project['repo_id'] : null;
            if ($repoId === null && $project['repo_full_name'] !== null) {
                $repoId = $byName[strtolower($project['repo_full_name'])] ?? null;
            }
            if ($repoId !== null) {
                $map[$repoId][] = $project;
            }
        }

        return $map;
    }

    /**
     * @param array<string, mixed> $row
     * @return VercelProject
     */
    private static function hydrate(array $row): array
    {
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;

        return [
            'id' => (string)$row['id'],
            'name' => (string)$row['name'],
            'repo_id' => isset($row['repo_id']) ? (int)$row['repo_id'] : null,
            'repo_full_name' => $str('repo_full_name'),
            'production_domain' => $str('production_domain'),
            'deploy_state' => $str('deploy_state'),
            'deploy_created_at' => $str('deploy_created_at'),
            'deploy_inspector_url' => $str('deploy_inspector_url'),
            'deploy_commit' => $str('deploy_commit'),
            'deploy_error' => $str('deploy_error'),
            'synced_at' => (string)$row['synced_at'],
        ];
    }
}
