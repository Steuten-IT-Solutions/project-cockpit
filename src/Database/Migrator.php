<?php

declare(strict_types=1);

namespace Cockpit\Database;

use PDO;
use RuntimeException;

/**
 * Applies migrations/NNNN_name.sql files in order, each exactly once.
 *
 * There is no SSH on the host, so migrations run from the cron job and from the
 * setup page rather than from a deploy step. MariaDB commits DDL implicitly, so a
 * migration is not wrapped in a transaction: keep each file small and idempotent
 * where possible.
 */
final class Migrator
{
    public function __construct(private readonly PDO $pdo, private readonly string $directory)
    {
    }

    /**
     * @return list<string> versions applied by this call
     */
    public function migrate(): array
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(64) NOT NULL PRIMARY KEY,
                applied_at DATETIME NOT NULL
            )'
        );

        $stmt = $this->pdo->prepare('SELECT version FROM schema_migrations');
        $stmt->execute();
        $applied = $stmt->fetchAll(PDO::FETCH_COLUMN);
        $done = [];

        foreach ($this->pending($applied) as $version => $file) {
            $sql = file_get_contents($file);
            if ($sql === false) {
                throw new RuntimeException(sprintf('Migration %s could not be read.', $version));
            }
            foreach (self::statements($sql) as $statement) {
                $this->pdo->exec($statement);
            }
            $insert = $this->pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
            $insert->execute([$version, gmdate('Y-m-d H:i:s')]);
            $done[] = $version;
        }

        return $done;
    }

    public function currentVersion(): ?string
    {
        try {
            $stmt = $this->pdo->prepare('SELECT MAX(version) FROM schema_migrations');
            $stmt->execute();
            $version = $stmt->fetchColumn();
        } catch (\PDOException) {
            return null;
        }

        return is_string($version) ? $version : null;
    }

    /**
     * @param array<mixed> $applied
     * @return array<string, string> version => file, sorted
     */
    private function pending(array $applied): array
    {
        $files = glob(rtrim($this->directory, '/') . '/*.sql') ?: [];
        sort($files, SORT_STRING);

        $pending = [];
        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (!in_array($version, $applied, true)) {
                $pending[$version] = $file;
            }
        }

        return $pending;
    }

    /**
     * Splits a migration into statements on semicolons at the end of a line.
     * Migrations must not contain semicolons at line ends inside string literals.
     *
     * @return list<string>
     */
    public static function statements(string $sql): array
    {
        $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? '';
        $parts = preg_split('/;\s*$/m', $sql) ?: [];

        return array_values(array_filter(array_map('trim', $parts), static fn (string $s): bool => $s !== ''));
    }
}
