<?php

declare(strict_types=1);

namespace Cockpit\Status;

use Closure;
use Cockpit\Http\Response;

/**
 * Accepts status reports at POST / of the status subdomain (receiver/index.php).
 *
 * Same limits as tools/status-empfang in the Kompanie-App-Template: at most 4 KiB per
 * report, 2000 reports per hour in total, 2000 stored rows, rows without a new report
 * for 60 days are removed. The repository is only created once a report passed
 * validation, so junk requests never open a database connection.
 */
final class Receiver
{
    public const MAX_BODY = 4096;
    public const MAX_PER_HOUR = 2000;
    public const MAX_ROWS = 2000;
    public const KEEP_DAYS = 60;

    /**
     * @param Closure(): StatusRepository $repository
     */
    public function __construct(
        private readonly Closure $repository,
        private readonly string $org,
    ) {
    }

    public function handle(string $method, string $path, string $body, int $now): Response
    {
        if ($method !== 'POST' || $path !== '/') {
            return self::json(404, ['error' => 'not found']);
        }
        if (strlen($body) > self::MAX_BODY) {
            return self::json(413, ['error' => 'too large']);
        }
        try {
            $payload = json_decode($body, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::json(400, ['error' => 'invalid']);
        }
        $row = StatusReport::fromPayload($payload, $this->org, $now);
        if ($row === null) {
            return self::json(400, ['error' => 'invalid']);
        }

        $repository = ($this->repository)();
        if ($repository->countInHour(gmdate('YmdH', $now), gmdate('YmdH', $now - 86400)) > self::MAX_PER_HOUR) {
            return self::json(429, ['error' => 'too many reports']);
        }
        // Prune first, then count: a full table frees up once old rows expire.
        $repository->pruneBefore(gmdate('Y-m-d H:i:s', $now - self::KEEP_DAYS * 86400));
        if (!$repository->exists($row['kompanie'], $row['variant']) && $repository->count() >= self::MAX_ROWS) {
            return self::json(507, ['error' => 'full']);
        }
        $repository->save($row, gmdate('Y-m-d H:i:s', $now));

        return self::json(200, ['ok' => true]);
    }

    /**
     * @param array<string, mixed> $body
     */
    public static function json(int $status, array $body): Response
    {
        return new Response($status, (string)json_encode($body), ['Content-Type' => 'application/json; charset=utf-8']);
    }
}
