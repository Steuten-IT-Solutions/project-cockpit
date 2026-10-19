<?php

declare(strict_types=1);

namespace Cockpit\Auth;

use Cockpit\Security\Crypto;
use PDO;

final class AuthLog
{
    public function __construct(private readonly PDO $pdo, private readonly Crypto $crypto)
    {
    }

    public function record(string $event, ?int $userId, string $ip): void
    {
        $this->pdo->prepare('INSERT INTO auth_events (user_id, event, ip_hash, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $event, $this->crypto->hash('ip', $ip), gmdate('Y-m-d H:i:s')]);
    }

    /**
     * @return list<array{event: string, created_at: string}>
     */
    public function recent(int $userId, int $limit = 5): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT event, created_at FROM auth_events WHERE user_id = ? ORDER BY id DESC LIMIT ' . max(1, min($limit, 50))
        );
        $stmt->execute([$userId]);

        /** @var list<array{event: string, created_at: string}> */
        return $stmt->fetchAll();
    }
}
