<?php

declare(strict_types=1);

namespace Cockpit\GitHub;

/**
 * Maps GitHub API payloads to a projects table row. Pure, so it can be tested
 * without the network.
 */
final class RepoSnapshot
{
    /**
     * @param array<mixed> $repo item from GET /installation/repositories
     * @param array<mixed>|null $release GET /repos/{repo}/releases/latest, null if there is none
     * @param array<mixed>|null $run first item of GET /repos/{repo}/actions/runs on the default branch
     * @return array<string, int|string|null>
     */
    public static function row(array $repo, ?array $release, ?array $run, int $openPullRequests, string $syncedAt): array
    {
        // open_issues_count counts open pull requests as well.
        $openIssues = max(0, self::int($repo['open_issues_count'] ?? 0) - $openPullRequests);

        return [
            'id' => self::int($repo['id'] ?? 0),
            'full_name' => self::str($repo['full_name'] ?? '', 200),
            'owner' => self::str($repo['owner']['login'] ?? '', 100),
            'name' => self::str($repo['name'] ?? '', 100),
            'description' => self::nullableStr($repo['description'] ?? null, 500),
            'html_url' => self::url($repo['html_url'] ?? null) ?? '',
            'is_private' => ($repo['private'] ?? false) === true ? 1 : 0,
            'is_archived' => ($repo['archived'] ?? false) === true ? 1 : 0,
            'is_fork' => ($repo['fork'] ?? false) === true ? 1 : 0,
            'default_branch' => self::str($repo['default_branch'] ?? 'main', 100),
            'pushed_at' => self::time($repo['pushed_at'] ?? null),
            'open_issues' => $openIssues,
            'open_prs' => $openPullRequests,
            'release_tag' => $release === null ? null : self::nullableStr($release['tag_name'] ?? null, 100),
            'release_url' => $release === null ? null : self::url($release['html_url'] ?? null),
            'release_at' => $release === null ? null : self::time($release['published_at'] ?? null),
            'ci_status' => $run === null ? null : self::nullableStr($run['status'] ?? null, 20),
            'ci_conclusion' => $run === null ? null : self::nullableStr($run['conclusion'] ?? null, 20),
            'ci_url' => $run === null ? null : self::url($run['html_url'] ?? null),
            'ci_at' => $run === null ? null : self::time($run['updated_at'] ?? null),
            'ci_workflow' => $run === null ? null : self::nullableStr($run['name'] ?? null, 200),
            'synced_at' => $syncedAt,
        ];
    }

    private static function int(mixed $value): int
    {
        return is_int($value) ? $value : 0;
    }

    private static function str(mixed $value, int $max): string
    {
        return is_string($value) ? mb_substr($value, 0, $max) : '';
    }

    private static function nullableStr(mixed $value, int $max): ?string
    {
        return is_string($value) && $value !== '' ? mb_substr($value, 0, $max) : null;
    }

    /**
     * Only https links to github.com are stored, so a template can render them as links safely.
     */
    private static function url(mixed $value): ?string
    {
        return is_string($value) && str_starts_with($value, 'https://github.com/') && strlen($value) <= 300 ? $value : null;
    }

    private static function time(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        $ts = strtotime($value);

        return $ts === false ? null : gmdate('Y-m-d H:i:s', $ts);
    }
}
