<?php

declare(strict_types=1);

namespace Cockpit\Releases;

use Cockpit\Config;
use Cockpit\GitHub\Client;
use RuntimeException;

/**
 * Reads the release runs of the template repository through the GitHub App (read-only, token limited to that
 * repository). The webhook (GitHubWebhook) records runs within seconds; this class completes them (does a sync
 * run publish? which core version?) right after a webhook and from the cron job, which also catches runs whose
 * webhook got lost.
 */
final class ReleaseSync
{
    /** Pending runs older than this are not looked at again. */
    private const PENDING_DAYS = 7;
    /** Runs without a release are kept this long, so the cron job does not read their jobs again. */
    private const KEEP_QUIET_DAYS = 30;
    private const KEEP_DAYS = 400;

    public function __construct(
        private readonly Client $client,
        private readonly ReleaseStore $store,
        private readonly string $repo,
    ) {
    }

    public static function fromConfig(Config $config, ReleaseStore $store): ?self
    {
        if ($config->releases === null || $config->github === null) {
            return null;
        }
        $key = @file_get_contents($config->github['private_key_file']);
        if ($key === false) {
            throw new RuntimeException('Schlüsseldatei der GitHub App nicht lesbar.');
        }

        return new self(new Client($config->github['client_id'], $key, $config->github['api_base']), $store, $config->releases['repo']);
    }

    /**
     * Cron job: the latest runs of both workflows, then the missing details.
     *
     * @return array{runs: int}
     */
    public function run(int $now): array
    {
        $token = $this->token($now);
        $base = $this->base();
        $seen = 0;
        foreach ([
            '/actions/workflows/kern-freigeben.yml/runs?per_page=5',
            '/actions/workflows/kompanien-abgleichen.yml/runs?per_page=10&branch=develop',
            '/actions/workflows/kompanien-abgleichen.yml/runs?per_page=10&branch=main',
        ] as $path) {
            [$status, $body] = $this->client->get($base . $path, $token);
            // 404: the workflow does not exist (yet) in this repository.
            if ($status === 404) {
                continue;
            }
            if ($status !== 200 || !is_array($body) || !is_array($body['workflow_runs'] ?? null)) {
                throw new RuntimeException(sprintf('GitHub returned %d for the workflow runs%s.', $status, Client::reason($body)));
            }
            foreach ($body['workflow_runs'] as $run) {
                $row = is_array($run) ? ReleaseRun::fromApi($run) : null;
                if ($row !== null) {
                    $this->store->upsert($row);
                    $seen++;
                }
            }
        }
        $this->complete($now, $token);
        $this->store->prune(gmdate('Y-m-d H:i:s', $now - self::KEEP_QUIET_DAYS * 86400), gmdate('Y-m-d H:i:s', $now - self::KEEP_DAYS * 86400));

        return ['runs' => $seen];
    }

    /**
     * Fills in whether sync runs publish and the core version of releasing runs.
     */
    public function complete(int $now, ?string $token = null): void
    {
        $pending = $this->store->pending(gmdate('Y-m-d H:i:s', $now - self::PENDING_DAYS * 86400), 20);
        if ($pending === []) {
            return;
        }
        $token ??= $this->token($now);
        $base = $this->base();
        foreach ($pending as $run) {
            $publishing = $run['publishing'];
            if ($publishing === null) {
                [$status, $body] = $this->client->get($base . '/actions/runs/' . $run['id'] . '/jobs?per_page=100', $token);
                if ($status !== 200 || !is_array($body) || !is_array($body['jobs'] ?? null)) {
                    continue;
                }
                $found = false;
                foreach ($body['jobs'] as $job) {
                    $found = $found || (is_array($job) && ReleaseRun::isPublishingJob($job));
                }
                // While "finden" still runs, a run without publishing jobs may still get some.
                if ($found || $run['status'] === 'completed') {
                    $this->store->setPublishing($run['id'], $found);
                    $publishing = $found ? 1 : 0;
                }
            }
            if ($publishing === 1 && $run['core_version'] === null) {
                [$status, $body] = $this->client->get($base . '/contents/VERSION?ref=' . $run['head_sha'], $token);
                $version = $status === 200 ? ReleaseRun::coreVersion($body) : null;
                if ($version !== null) {
                    $this->store->setCoreVersion($run['id'], $version);
                }
            }
        }
    }

    private function base(): string
    {
        return '/repos/' . implode('/', array_map('rawurlencode', explode('/', $this->repo, 2)));
    }

    private function token(int $now): string
    {
        [$owner, $name] = explode('/', $this->repo, 2);
        foreach ($this->client->installations($now) as $installation) {
            if (strcasecmp($installation['account'], $owner) === 0) {
                return $this->client->installationToken($installation['id'], $now, [$name], ['actions' => 'read', 'contents' => 'read', 'metadata' => 'read']);
            }
        }
        throw new RuntimeException(sprintf('Die GitHub App ist nicht bei %s installiert.', $owner));
    }
}
