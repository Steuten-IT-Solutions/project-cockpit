<?php

declare(strict_types=1);

namespace Cockpit\Notify;

use PDO;

/**
 * Web push subscriptions (migration 0006). Only the endpoint is stored: pushes carry no payload.
 */
final class PushSubscriptionRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function add(int $userId, string $endpoint, string $now): void
    {
        $this->pdo->prepare('INSERT INTO push_subscriptions (user_id, endpoint, created_at) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), last_error = NULL')->execute([$userId, $endpoint, $now]);
    }

    public function remove(string $endpoint): void
    {
        $this->pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')->execute([$endpoint]);
    }

    public function markError(string $endpoint, string $error): void
    {
        $this->pdo->prepare('UPDATE push_subscriptions SET last_error = ? WHERE endpoint = ?')->execute([mb_substr($error, 0, 255), $endpoint]);
    }

    /**
     * @return list<array{endpoint: string, created_at: string, last_error: ?string}>
     */
    public function all(): array
    {
        $stmt = $this->pdo->prepare('SELECT endpoint, created_at, last_error FROM push_subscriptions ORDER BY created_at');
        $stmt->execute();

        return array_values(array_map(static fn (array $r): array => [
            'endpoint' => (string)$r['endpoint'],
            'created_at' => (string)$r['created_at'],
            'last_error' => isset($r['last_error']) ? (string)$r['last_error'] : null,
        ], $stmt->fetchAll()));
    }
}
