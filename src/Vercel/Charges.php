<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use RuntimeException;

/**
 * Sums the FOCUS charge records of GET /v1/billing/charges (JSON Lines, one charge per
 * line) per service, charge category and project.
 *
 * @phpstan-type ChargeSum array{
 *     service: string, category: string, project: ?string,
 *     billed_cost: float, effective_cost: float, currency: string
 * }
 */
final class Charges
{
    private const CATEGORIES = ['Adjustment', 'Credit', 'Purchase', 'Tax', 'Usage'];

    /**
     * @return list<ChargeSum>
     */
    public static function aggregate(string $jsonl): array
    {
        $sums = [];
        foreach (preg_split('/\r?\n/', $jsonl) ?: [] as $number => $line) {
            if (trim($line) === '') {
                continue;
            }
            $charge = json_decode($line, true);
            if (!is_array($charge)) {
                throw new RuntimeException(sprintf('Unexpected charges response (line %d is not JSON).', $number + 1));
            }
            $billed = self::number($charge['BilledCost'] ?? null);
            $effective = self::number($charge['EffectiveCost'] ?? null) ?? $billed;
            $currency = $charge['BillingCurrency'] ?? null;
            if ($billed === null || $effective === null || !is_string($currency) || !preg_match('/^[A-Z]{3}$/D', $currency)) {
                throw new RuntimeException(sprintf('Unexpected charges response (line %d lacks cost or currency).', $number + 1));
            }
            $service = self::text($charge['ServiceName'] ?? null) ?? 'Unbekannt';
            $category = in_array($charge['ChargeCategory'] ?? null, self::CATEGORIES, true) ? (string)$charge['ChargeCategory'] : 'Other';
            $project = self::projectName($charge['Tags'] ?? null);

            $key = $service . "\0" . $category . "\0" . ($project ?? '') . "\0" . $currency;
            $sums[$key] ??= [
                'service' => $service,
                'category' => $category,
                'project' => $project,
                'billed_cost' => 0.0,
                'effective_cost' => 0.0,
                'currency' => $currency,
            ];
            $sums[$key]['billed_cost'] += $billed;
            $sums[$key]['effective_cost'] += $effective;
        }

        return array_values($sums);
    }

    /**
     * Numbers arrive as JSON numbers or as decimal strings (the documented example uses "123").
     */
    private static function number(mixed $value): ?float
    {
        if (is_int($value) || is_float($value)) {
            return (float)$value;
        }
        if (is_string($value) && preg_match('/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/D', $value)) {
            return (float)$value;
        }

        return null;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim((string)preg_replace('/[^\P{C}]+/u', ' ', $value));

        return $value === '' ? null : mb_substr($value, 0, 150);
    }

    /**
     * The project name from the charge's tags; Vercel documents that they carry the
     * project id and name but not the exact key, so any key ending in "ProjectName" counts.
     */
    private static function projectName(mixed $tags): ?string
    {
        if (!is_array($tags)) {
            return null;
        }
        foreach ($tags as $key => $value) {
            if (is_string($key) && preg_match('/projectname$/i', $key)) {
                return self::text($value);
            }
        }

        return null;
    }
}
