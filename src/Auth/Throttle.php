<?php

declare(strict_types=1);

namespace Cockpit\Auth;

use Cockpit\Security\Crypto;
use PDO;

/**
 * Counts failed attempts per account and per client IP in a sliding window.
 * Keys are stored as keyed hashes, never in clear text.
 */
final class Throttle
{
    public const WINDOW_SECONDS = 15 * 60;
    public const MAX_PER_ACCOUNT = 5;
    public const MAX_PER_IP = 20;

    public function __construct(private readonly PDO $pdo, private readonly Crypto $crypto)
    {
    }

    public function isBlocked(string $username, string $ip): bool
    {
        return $this->failures('account', $username) >= self::MAX_PER_ACCOUNT
            || $this->failures('ip', $ip) >= self::MAX_PER_IP;
    }

    public function recordFailure(string $username, string $ip): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('INSERT INTO auth_attempts (scope, key_hash, created_at) VALUES (?, ?, ?)');
        $stmt->execute(['account', $this->key('account', $username), $now]);
        $stmt->execute(['ip', $this->key('ip', $ip), $now]);

        // Keep the table small; a day is far longer than any window.
        $this->pdo->prepare('DELETE FROM auth_attempts WHERE created_at < ?')
            ->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);
    }

    public function clearAccount(string $username): void
    {
        $this->pdo->prepare('DELETE FROM auth_attempts WHERE scope = ? AND key_hash = ?')
            ->execute(['account', $this->key('account', $username)]);
    }

    private function failures(string $scope, string $value): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM auth_attempts WHERE scope = ? AND key_hash = ? AND created_at >= ?'
        );
        $stmt->execute([$scope, $this->key($scope, $value), gmdate('Y-m-d H:i:s', time() - self::WINDOW_SECONDS)]);

        return (int)$stmt->fetchColumn();
    }

    private function key(string $scope, string $value): string
    {
        return $this->crypto->hash('throttle-' . $scope, mb_strtolower($value));
    }
}
