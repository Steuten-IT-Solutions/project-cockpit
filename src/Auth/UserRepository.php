<?php

declare(strict_types=1);

namespace Cockpit\Auth;

use PDO;

final class UserRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function count(): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM users');
        $stmt->execute();

        return (int)$stmt->fetchColumn();
    }

    /**
     * @return array{id: int, username: string, password_hash: string, totp_secret_enc: string, totp_last_step: ?int}|null
     */
    public function findByUsername(string $username): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, username, password_hash, totp_secret_enc, totp_last_step FROM users WHERE username = ?'
        );
        $stmt->execute([$username]);

        return self::hydrate($stmt->fetch());
    }

    /**
     * @return array{id: int, username: string, password_hash: string, totp_secret_enc: string, totp_last_step: ?int}|null
     */
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, username, password_hash, totp_secret_enc, totp_last_step FROM users WHERE id = ?'
        );
        $stmt->execute([$id]);

        return self::hydrate($stmt->fetch());
    }

    /**
     * @param list<string> $recoveryCodeHashes
     */
    public function create(string $username, string $passwordHash, string $totpSecretEnc, int $totpStep, array $recoveryCodeHashes): int
    {
        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO users (username, password_hash, totp_secret_enc, totp_last_step, created_at) VALUES (?, ?, ?, ?, ?)'
            );
            $stmt->execute([$username, $passwordHash, $totpSecretEnc, $totpStep, gmdate('Y-m-d H:i:s')]);
            $id = (int)$this->pdo->lastInsertId();

            $insert = $this->pdo->prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
            foreach ($recoveryCodeHashes as $hash) {
                $insert->execute([$id, $hash]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return $id;
    }

    /**
     * Stores the accepted TOTP step, but only if it is newer than the stored one,
     * so two parallel requests cannot both use the same code.
     */
    public function claimTotpStep(int $userId, int $step): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)'
        );
        $stmt->execute([$step, $userId, $step]);

        return $stmt->rowCount() === 1;
    }

    /**
     * Marks a recovery code as used. Returns false if it is unknown or already used.
     */
    public function useRecoveryCode(int $userId, string $codeHash): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL'
        );
        $stmt->execute([gmdate('Y-m-d H:i:s'), $userId, $codeHash]);

        return $stmt->rowCount() === 1;
    }

    public function remainingRecoveryCodes(int $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL');
        $stmt->execute([$userId]);

        return (int)$stmt->fetchColumn();
    }

    public function updatePasswordHash(int $userId, string $hash): void
    {
        $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $userId]);
    }

    public function touchLogin(int $userId): void
    {
        $this->pdo->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s'), $userId]);
    }

    /**
     * @return array{id: int, username: string, password_hash: string, totp_secret_enc: string, totp_last_step: ?int}|null
     */
    private static function hydrate(mixed $row): ?array
    {
        if (!is_array($row)) {
            return null;
        }

        return [
            'id' => (int)$row['id'],
            'username' => (string)$row['username'],
            'password_hash' => (string)$row['password_hash'],
            'totp_secret_enc' => (string)$row['totp_secret_enc'],
            'totp_last_step' => $row['totp_last_step'] === null ? null : (int)$row['totp_last_step'],
        ];
    }
}
