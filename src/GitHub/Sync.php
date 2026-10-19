<?php

declare(strict_types=1);

namespace Cockpit\GitHub;

use Cockpit\Projects\ProjectRepository;
use Throwable;

/**
 * Pulls the state of every repository the GitHub App can see into the projects table.
 * Runs from the cron job; pages only ever read the stored copy.
 */
final class Sync
{
    /**
     * @param list<string> $allowedAccounts installations on other accounts are ignored
     */
    public function __construct(
        private readonly Client $client,
        private readonly ProjectRepository $projects,
        private readonly array $allowedAccounts,
    ) {
    }

    /**
     * @return array{repos: int, errors: list<string>}
     */
    public function run(int $now): array
    {
        $allowed = array_map('strtolower', $this->allowedAccounts);
        $seen = [];
        $errors = [];
        $syncedAt = gmdate('Y-m-d H:i:s', $now);

        foreach ($this->client->installations($now) as $installation) {
            if (!in_array(strtolower($installation['account']), $allowed, true)) {
                continue;
            }
            $token = $this->client->installationToken($installation['id'], $now);

            foreach ($this->client->paginate('/installation/repositories?per_page=100', $token, 'repositories') as $repo) {
                if (!is_array($repo) || !is_int($repo['id'] ?? null) || !is_string($repo['full_name'] ?? null)) {
                    continue;
                }
                $seen[] = $repo['id'];
                try {
                    $this->projects->upsert($this->snapshot($repo, $token, $syncedAt));
                } catch (Throwable $e) {
                    $errors[] = $repo['full_name'] . ': ' . $e->getMessage();
                    $this->projects->markError($repo['id'], mb_substr($e->getMessage(), 0, 255));
                }
            }
        }

        $this->projects->markUnavailableExcept($seen);

        return ['repos' => count($seen), 'errors' => $errors];
    }

    /**
     * @param array<mixed> $repo
     * @return array<string, int|string|null>
     */
    private function snapshot(array $repo, string $token, string $syncedAt): array
    {
        $fullName = (string)$repo['full_name'];
        $path = '/repos/' . implode('/', array_map('rawurlencode', explode('/', $fullName, 2)));

        [$status, $release] = $this->client->get($path . '/releases/latest', $token);
        $release = $status === 200 && is_array($release) ? $release : null;

        $branch = is_string($repo['default_branch'] ?? null) ? $repo['default_branch'] : 'main';
        [$status, $runs] = $this->client->get($path . '/actions/runs?per_page=1&branch=' . rawurlencode($branch), $token);
        $run = $status === 200 && is_array($runs) && is_array($runs['workflow_runs'][0] ?? null) ? $runs['workflow_runs'][0] : null;

        [$status, $pulls] = $this->client->get($path . '/pulls?state=open&per_page=100', $token);
        $openPullRequests = $status === 200 && is_array($pulls) ? count($pulls) : 0;

        return RepoSnapshot::row($repo, $release, $run, $openPullRequests, $syncedAt);
    }
}
