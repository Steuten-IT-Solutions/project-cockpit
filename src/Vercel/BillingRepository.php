<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use PDO;

/**
 * @phpstan-import-type ChargeSum from Charges
 * @phpstan-type BillingState array{period_from: ?string, period_to: ?string, synced_at: ?string, error: ?string, error_at: ?string}
 */
final class BillingRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Replaces the stored charges with a new result.
     *
     * @param list<ChargeSum> $sums
     */
    public function replace(array $sums, string $from, string $to, string $syncedAt): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('DELETE FROM vercel_charges')->execute();
            $insert = $this->pdo->prepare(
                'INSERT INTO vercel_charges (service, category, project, billed_cost, effective_cost, currency) VALUES (?, ?, ?, ?, ?, ?)'
            );
            foreach ($sums as $sum) {
                $insert->execute([
                    $sum['service'], $sum['category'], $sum['project'],
                    sprintf('%.6F', $sum['billed_cost']), sprintf('%.6F', $sum['effective_cost']), $sum['currency'],
                ]);
            }
            $this->pdo->prepare(
                'INSERT INTO vercel_billing (id, period_from, period_to, synced_at, error, error_at) VALUES (1, ?, ?, ?, NULL, NULL) '
                . 'ON DUPLICATE KEY UPDATE period_from = VALUES(period_from), period_to = VALUES(period_to), '
                . 'synced_at = VALUES(synced_at), error = NULL, error_at = NULL'
            )->execute([$from, $to, $syncedAt]);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Records a failed sync; the last successful result stays.
     */
    public function fail(string $error, string $at): void
    {
        $this->pdo->prepare(
            'INSERT INTO vercel_billing (id, error, error_at) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE error = VALUES(error), error_at = VALUES(error_at)'
        )->execute([mb_substr($error, 0, 255), $at]);
    }

    /**
     * @return BillingState|null
     */
    public function state(): ?array
    {
        $stmt = $this->pdo->prepare('SELECT period_from, period_to, synced_at, error, error_at FROM vercel_billing WHERE id = 1');
        $stmt->execute();
        $row = $stmt->fetch();
        if (!is_array($row)) {
            return null;
        }
        $str = static fn (string $k): ?string => isset($row[$k]) ? (string)$row[$k] : null;

        return [
            'period_from' => $str('period_from'),
            'period_to' => $str('period_to'),
            'synced_at' => $str('synced_at'),
            'error' => $str('error'),
            'error_at' => $str('error_at'),
        ];
    }

    /**
     * @return list<ChargeSum>
     */
    public function charges(): array
    {
        $stmt = $this->pdo->prepare('SELECT service, category, project, billed_cost, effective_cost, currency FROM vercel_charges');
        $stmt->execute();

        return array_values(array_map(static fn (array $r): array => [
            'service' => (string)$r['service'],
            'category' => (string)$r['category'],
            'project' => isset($r['project']) ? (string)$r['project'] : null,
            'billed_cost' => (float)$r['billed_cost'],
            'effective_cost' => (float)$r['effective_cost'],
            'currency' => (string)$r['currency'],
        ], $stmt->fetchAll()));
    }
}
