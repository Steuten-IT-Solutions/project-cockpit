<?php

declare(strict_types=1);

namespace Cockpit\Releases;

use Closure;
use Cockpit\Http\Response;
use Cockpit\Status\Receiver;

/**
 * Accepts the GitHub App's webhook at POST /github of the status subdomain (receiver/index.php), so that the
 * cockpit learns within seconds that a release starts or ends. Only the events "workflow_run" and "workflow_job"
 * of the configured template repository are used; everything else is acknowledged and ignored.
 *
 * Every delivery must carry X-Hub-Signature-256 (HMAC-SHA256 of the body with the webhook secret). GitHub's
 * deliveries carry no timestamp, so a recorded delivery could be sent again; it can only restore an older state,
 * which ReleaseStore::upsert() ignores, or mark a run as publishing that published.
 */
final class GitHubWebhook
{
    /** workflow_run payloads are some 30 KiB; GitHub caps payloads at 25 MB. */
    public const MAX_BODY = 1048576;

    /**
     * @param Closure(): ReleaseStore $store opened only for a valid delivery
     */
    public function __construct(
        private readonly Closure $store,
        private readonly string $repo,
        private readonly string $secret,
    ) {
    }

    /**
     * @param string $event X-GitHub-Event
     * @param string $signature X-Hub-Signature-256 ('' if missing)
     * @return array{Response, bool} the response and whether a run was recorded (then complete it via ReleaseSync)
     */
    public function handle(string $method, string $event, string $body, string $signature): array
    {
        if ($method !== 'POST') {
            return [Receiver::json(404, ['error' => 'not found']), false];
        }
        if (strlen($body) > self::MAX_BODY) {
            return [Receiver::json(413, ['error' => 'too large']), false];
        }
        if (!hash_equals('sha256=' . hash_hmac('sha256', $body, $this->secret), $signature)) {
            return [Receiver::json(401, ['error' => 'signature']), false];
        }
        if ($event !== 'workflow_run' && $event !== 'workflow_job') {
            // "ping" when the webhook is set up, and events nobody asked for.
            return [Receiver::json(200, ['ok' => true]), false];
        }
        try {
            $payload = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [Receiver::json(400, ['error' => 'invalid']), false];
        }
        if (!is_array($payload) || !is_string($payload['repository']['full_name'] ?? null)
            || strcasecmp($payload['repository']['full_name'], $this->repo) !== 0) {
            return [Receiver::json(200, ['ok' => true]), false];
        }

        if ($event === 'workflow_run') {
            $row = is_array($payload['workflow_run'] ?? null) ? ReleaseRun::fromApi($payload['workflow_run']) : null;
            if ($row === null) {
                return [Receiver::json(200, ['ok' => true]), false];
            }
            ($this->store)()->upsert($row);

            return [Receiver::json(200, ['ok' => true]), true];
        }

        $job = $payload['workflow_job'] ?? null;
        if (!is_array($job) || !is_int($job['run_id'] ?? null) || !ReleaseRun::isPublishingJob($job)) {
            return [Receiver::json(200, ['ok' => true]), false];
        }
        ($this->store)()->markPublishing($job['run_id']);

        // Completing reads the core version of the run that now publishes.
        return [Receiver::json(200, ['ok' => true]), true];
    }
}
