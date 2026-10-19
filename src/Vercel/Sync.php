<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use RuntimeException;
use Throwable;

/**
 * Reads every project of the team and its latest production deployment into
 * the vercel_projects table. The GitHub repository id in a project's link ties
 * it to the matching project card.
 */
final class Sync
{
    public function __construct(private readonly Client $client, private readonly VercelRepository $store)
    {
    }

    /**
     * @return array{projects: int, errors: list<string>}
     */
    public function run(int $now): array
    {
        [$status, $body] = $this->client->get('/v10/projects', ['limit' => 100]);
        if ($status !== 200) {
            throw new RuntimeException(sprintf('Vercel returned %d for /v10/projects%s.', $status, Client::reason($body)));
        }
        // The endpoint answers with either a bare list or {projects, pagination}.
        $projects = is_array($body) && array_is_list($body) ? $body : (is_array($body) ? ($body['projects'] ?? null) : null);
        if (!is_array($projects)) {
            throw new RuntimeException('Unexpected response for /v10/projects.');
        }

        $seen = [];
        $errors = [];
        $syncedAt = gmdate('Y-m-d H:i:s', $now);
        foreach ($projects as $project) {
            if (!is_array($project) || !is_string($project['id'] ?? null)) {
                continue;
            }
            $seen[] = $project['id'];
            try {
                [$status, $deployments] = $this->client->get('/v7/deployments', [
                    'projectId' => $project['id'],
                    'target' => 'production',
                    'limit' => 1,
                ]);
                if ($status !== 200) {
                    throw new RuntimeException(sprintf('Vercel returned %d for deployments%s', $status, Client::reason($deployments)));
                }
                $deployment = is_array($deployments) && is_array($deployments['deployments'][0] ?? null) ? $deployments['deployments'][0] : null;
                $this->store->upsert(VercelSnapshot::row($project, $deployment, $syncedAt));
            } catch (Throwable $e) {
                $name = is_string($project['name'] ?? null) ? $project['name'] : $project['id'];
                $errors[] = $name . ': ' . $e->getMessage();
            }
        }
        $this->store->markUnavailableExcept($seen);

        return ['projects' => count($seen), 'errors' => $errors];
    }
}
