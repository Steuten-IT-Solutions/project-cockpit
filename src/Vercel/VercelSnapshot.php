<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

/**
 * Maps Vercel API payloads to a vercel_projects row. Pure, so it can be tested offline.
 */
final class VercelSnapshot
{
    /**
     * @param array<mixed> $project item from GET /v10/projects
     * @param array<mixed>|null $deployment first item of GET /v7/deployments?target=production
     * @return array<string, int|string|null>
     */
    public static function row(array $project, ?array $deployment, string $syncedAt): array
    {
        $link = is_array($project['link'] ?? null) ? $project['link'] : [];
        $repoId = $link['repoId'] ?? null;
        $repoFullName = is_string($link['org'] ?? null) && is_string($link['repo'] ?? null)
            ? mb_substr($link['org'] . '/' . $link['repo'], 0, 200)
            : null;

        $state = null;
        $commit = null;
        if ($deployment !== null) {
            $state = $deployment['state'] ?? $deployment['readyState'] ?? null;
            $commit = $deployment['meta']['githubCommitMessage'] ?? null;
        }

        return [
            'id' => mb_substr((string)$project['id'], 0, 64),
            'name' => mb_substr(is_string($project['name'] ?? null) ? $project['name'] : '', 0, 100),
            'repo_id' => is_int($repoId) || (is_string($repoId) && ctype_digit($repoId)) ? (int)$repoId : null,
            'repo_full_name' => $repoFullName,
            'production_domain' => self::productionDomain($project),
            'deploy_state' => is_string($state) ? mb_substr($state, 0, 20) : null,
            'deploy_created_at' => $deployment !== null ? self::time($deployment['created'] ?? $deployment['createdAt'] ?? null) : null,
            'deploy_inspector_url' => $deployment !== null ? self::vercelUrl($deployment['inspectorUrl'] ?? null) : null,
            'deploy_commit' => is_string($commit) ? mb_substr(strtok($commit, "\n") ?: '', 0, 255) : null,
            'deploy_error' => $deployment !== null && is_string($deployment['errorMessage'] ?? null)
                ? mb_substr($deployment['errorMessage'], 0, 255) : null,
            'synced_at' => $syncedAt,
        ];
    }

    /**
     * Picks a production alias, preferring a custom domain over *.vercel.app.
     *
     * @param array<mixed> $project
     */
    public static function productionDomain(array $project): ?string
    {
        $candidates = [];
        foreach (is_array($project['alias'] ?? null) ? $project['alias'] : [] as $alias) {
            if (!is_array($alias) || !is_string($alias['domain'] ?? null)) {
                continue;
            }
            $isProduction = ($alias['target'] ?? null) === 'PRODUCTION' || ($alias['environment'] ?? null) === 'production';
            if ($isProduction && preg_match('/^[a-z0-9.-]{1,253}$/i', $alias['domain'])) {
                $candidates[] = strtolower($alias['domain']);
            }
        }
        usort($candidates, static fn (string $a, string $b): int => [str_ends_with($a, '.vercel.app'), strlen($a)] <=> [str_ends_with($b, '.vercel.app'), strlen($b)]);

        return $candidates[0] ?? null;
    }

    private static function vercelUrl(mixed $value): ?string
    {
        return is_string($value) && str_starts_with($value, 'https://vercel.com/') && strlen($value) <= 300 ? $value : null;
    }

    /**
     * Vercel timestamps are milliseconds since the epoch.
     */
    private static function time(mixed $value): ?string
    {
        return is_int($value) || is_float($value) ? gmdate('Y-m-d H:i:s', (int)($value / 1000)) : null;
    }
}
