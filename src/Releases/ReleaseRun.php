<?php

declare(strict_types=1);

namespace Cockpit\Releases;

/**
 * Maps GitHub workflow runs and jobs of the company app template (Kompanie-App-Template docs/RELEASE.md) to
 * release_runs rows. Pure, so it can be tested without the network.
 *
 * - "Kernversion freigeben" (kern-freigeben.yml) on main promotes the tested core: stable.
 * - "Kompanien abgleichen" (kompanien-abgleichen.yml) publishes new versions: on develop in the channel early,
 *   on main (schedule, after a promotion) stable. Most of its runs find nothing to publish; only runs with a job
 *   besides "finden" (the matrix job "veroeffentlichen (…) / build|publish") release anything.
 *
 * @phpstan-type Row array{
 *     id: int, workflow: string, channel: string, branch: string, event: string, status: string,
 *     conclusion: ?string, publishing: ?int, title: ?string, head_sha: string, html_url: string,
 *     started_at: string, updated_at: string
 * }
 */
final class ReleaseRun
{
    public const PROMOTE = 'promote';
    public const SYNC = 'sync';

    private const WORKFLOWS = [
        '.github/workflows/kern-freigeben.yml' => self::PROMOTE,
        '.github/workflows/kompanien-abgleichen.yml' => self::SYNC,
    ];

    /** The job of "Kompanien abgleichen" that only looks for companies to publish. */
    private const FIND_JOB = 'finden';

    /**
     * @param array<mixed> $run item of GET /repos/{repo}/actions/runs or workflow_run of a webhook
     * @return Row|null null for runs of other workflows or branches
     */
    public static function fromApi(array $run): ?array
    {
        $path = is_string($run['path'] ?? null) ? explode('@', $run['path'], 2)[0] : '';
        $workflow = self::WORKFLOWS[$path] ?? null;
        $branch = is_string($run['head_branch'] ?? null) ? $run['head_branch'] : '';
        $channel = match (true) {
            $workflow === self::PROMOTE && $branch === 'main' => 'stable',
            $workflow === self::SYNC && $branch === 'develop' => 'early',
            $workflow === self::SYNC && $branch === 'main' => 'stable',
            default => null,
        };
        $id = $run['id'] ?? null;
        $sha = is_string($run['head_sha'] ?? null) ? $run['head_sha'] : '';
        $url = $run['html_url'] ?? null;
        $started = self::time($run['run_started_at'] ?? null) ?? self::time($run['created_at'] ?? null);
        $updated = self::time($run['updated_at'] ?? null) ?? $started;
        if ($workflow === null || $channel === null || !is_int($id) || $id <= 0 || !preg_match('/^[0-9a-f]{40}$/D', $sha)
            || !is_string($url) || !str_starts_with($url, 'https://github.com/') || strlen($url) > 300
            || $started === null || $updated === null) {
            return null;
        }

        return [
            'id' => $id,
            'workflow' => $workflow,
            'channel' => $channel,
            'branch' => $branch,
            'event' => self::text($run['event'] ?? null, 30) ?? '',
            'status' => self::text($run['status'] ?? null, 20) ?? 'queued',
            'conclusion' => self::text($run['conclusion'] ?? null, 20),
            // A promotion always releases; whether a sync run does is known from its jobs.
            'publishing' => $workflow === self::PROMOTE ? 1 : null,
            'title' => self::text($run['display_title'] ?? null, 200),
            'head_sha' => $sha,
            'html_url' => $url,
            'started_at' => $started,
            'updated_at' => $updated,
        ];
    }

    /**
     * Whether a job (GET …/runs/{id}/jobs item or workflow_job of a webhook) publishes. Skipped jobs do not:
     * "veroeffentlichen" is skipped when "finden" found nothing.
     *
     * @param array<mixed> $job
     */
    public static function isPublishingJob(array $job): bool
    {
        $name = $job['name'] ?? null;

        return is_string($name) && $name !== '' && $name !== self::FIND_JOB && ($job['conclusion'] ?? null) !== 'skipped';
    }

    /**
     * The core version from GET /repos/{repo}/contents/VERSION, e.g. "0.1.1"; null if it is not one.
     */
    public static function coreVersion(mixed $body): ?string
    {
        if (!is_array($body) || ($body['encoding'] ?? null) !== 'base64' || !is_string($body['content'] ?? null)) {
            return null;
        }
        $content = base64_decode(str_replace(["\n", "\r"], '', $body['content']), true);
        $version = $content === false ? '' : trim($content);

        return preg_match('/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/D', $version) ? $version : null;
    }

    private static function text(mixed $value, int $max): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim((string)preg_replace('/[^\P{C}]+/u', ' ', $value));

        return $value === '' ? null : mb_substr($value, 0, $max);
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
