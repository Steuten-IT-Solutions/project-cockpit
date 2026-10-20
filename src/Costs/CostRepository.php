<?php

declare(strict_types=1);

namespace Cockpit\Costs;

use PDO;

/**
 * @phpstan-import-type CostInput from Cost
 * @phpstan-type StoredCost array{
 *     id: int, name: string, provider: ?string, amount_cents: int, currency: string,
 *     billing_interval: string, project_id: ?int, project_name: ?string, note: ?string, created_at: string
 * }
 */
final class CostRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param CostInput $cost
     */
    public function add(array $cost, string $createdAt): void
    {
        $this->pdo->prepare(
            'INSERT INTO costs (name, provider, amount_cents, currency, billing_interval, project_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $cost['name'], $cost['provider'], $cost['amount_cents'], $cost['currency'],
            $cost['billing_interval'], $cost['project_id'], $cost['note'], $createdAt,
        ]);
    }

    /**
     * Rewrites every field of an entry; its creation time stays.
     *
     * @param CostInput $cost
     */
    public function update(int $id, array $cost): void
    {
        $this->pdo->prepare(
            'UPDATE costs SET name = ?, provider = ?, amount_cents = ?, currency = ?, billing_interval = ?, project_id = ?, note = ? WHERE id = ?'
        )->execute([
            $cost['name'], $cost['provider'], $cost['amount_cents'], $cost['currency'],
            $cost['billing_interval'], $cost['project_id'], $cost['note'], $id,
        ]);
    }

    public function delete(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM costs WHERE id = ?');
        $stmt->execute([$id]);

        return $stmt->rowCount() > 0;
    }

    /**
     * @return StoredCost|null
     */
    public function find(int $id): ?array
    {
        return $this->select(' WHERE c.id = ?', [$id])[0] ?? null;
    }

    /**
     * @return list<StoredCost>
     */
    public function all(?int $projectId = null): array
    {
        return $projectId === null ? $this->select('', []) : $this->select(' WHERE c.project_id = ?', [$projectId]);
    }

    /**
     * @param list<int> $params
     * @return list<StoredCost>
     */
    private function select(string $where, array $params): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT c.*, p.name AS project_name FROM costs c LEFT JOIN projects p ON p.id = c.project_id' . $where . ' ORDER BY c.name, c.id'
        );
        $stmt->execute($params);

        return array_values(array_map(static fn (array $r): array => [
            'id' => (int)$r['id'],
            'name' => (string)$r['name'],
            'provider' => isset($r['provider']) ? (string)$r['provider'] : null,
            'amount_cents' => (int)$r['amount_cents'],
            'currency' => (string)$r['currency'],
            'billing_interval' => (string)$r['billing_interval'],
            'project_id' => isset($r['project_id']) ? (int)$r['project_id'] : null,
            'project_name' => isset($r['project_name']) ? (string)$r['project_name'] : null,
            'note' => isset($r['note']) ? (string)$r['note'] : null,
            'created_at' => (string)$r['created_at'],
        ], $stmt->fetchAll()));
    }
}
