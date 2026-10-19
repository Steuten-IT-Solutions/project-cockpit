<?php

declare(strict_types=1);

namespace Cockpit\Costs;

/**
 * Validation and arithmetic for costs entered by hand (German UI text).
 *
 * @phpstan-type CostInput array{
 *     name: string, provider: ?string, amount_cents: int, currency: string,
 *     billing_interval: string, project_id: ?int, note: ?string
 * }
 */
final class Cost
{
    public const CURRENCIES = ['EUR' => '€', 'USD' => 'US$'];
    public const INTERVALS = ['month' => 'monatlich', 'year' => 'jährlich'];

    /**
     * Validates the form fields; returns the row or a German error message.
     *
     * @param array<string, string> $in
     * @param list<int> $projectIds ids that may be linked
     * @return CostInput|string
     */
    public static function fromForm(array $in, array $projectIds): array|string
    {
        $name = self::text($in['name'] ?? '', 100);
        if ($name === null) {
            return 'Bitte einen Namen eingeben.';
        }
        $amount = self::parseAmount($in['amount'] ?? '');
        if ($amount === null) {
            return 'Der Betrag muss eine Zahl mit höchstens zwei Nachkommastellen sein, z. B. 12,99.';
        }
        $currency = $in['currency'] ?? '';
        if (!isset(self::CURRENCIES[$currency])) {
            return 'Unbekannte Währung.';
        }
        $interval = $in['interval'] ?? '';
        if (!isset(self::INTERVALS[$interval])) {
            return 'Unbekanntes Intervall.';
        }
        $project = $in['project'] ?? '';
        $projectId = null;
        if ($project !== '') {
            if (!ctype_digit($project) || !in_array((int)$project, $projectIds, true)) {
                return 'Unbekanntes Projekt.';
            }
            $projectId = (int)$project;
        }

        return [
            'name' => $name,
            'provider' => self::text($in['provider'] ?? '', 100),
            'amount_cents' => $amount,
            'currency' => $currency,
            'billing_interval' => $interval,
            'project_id' => $projectId,
            'note' => self::text($in['note'] ?? '', 255),
        ];
    }

    /**
     * "12,99", "12.99", "1.200,50" or "1200" in cents; null if not a plausible amount.
     */
    public static function parseAmount(string $value): ?int
    {
        $value = str_replace(' ', '', trim($value));
        if (preg_match('/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/D', $value)) {
            $value = str_replace('.', '', $value);
        }
        if (!preg_match('/^(\d{1,7})(?:[.,](\d{1,2}))?$/D', $value, $m)) {
            return null;
        }

        return (int)$m[1] * 100 + (int)str_pad($m[2] ?? '0', 2, '0');
    }

    /**
     * Monthly and yearly totals per currency, without converting between currencies.
     *
     * @param list<array{amount_cents: int, currency: string, billing_interval: string}> $costs
     * @return array<string, array{month: float, year: float}> currency → cents per month and per year
     */
    public static function totals(array $costs): array
    {
        $totals = [];
        foreach ($costs as $cost) {
            $yearly = $cost['billing_interval'] === 'year' ? $cost['amount_cents'] : $cost['amount_cents'] * 12;
            $totals[$cost['currency']] ??= ['month' => 0.0, 'year' => 0.0];
            $totals[$cost['currency']]['year'] += $yearly;
            $totals[$cost['currency']]['month'] += $yearly / 12;
        }
        ksort($totals);

        return $totals;
    }

    /**
     * German money format, e.g. "1.234,50 €"; amount in cents. A no-break space keeps
     * the amount and its currency on one line.
     */
    public static function money(float $cents, string $currency): string
    {
        return number_format($cents / 100, 2, ',', '.') . "\u{00A0}" . (self::CURRENCIES[$currency] ?? $currency);
    }

    private static function text(string $value, int $max): ?string
    {
        $value = trim((string)preg_replace('/[^\P{C}]+/u', ' ', $value));

        return $value === '' ? null : mb_substr($value, 0, $max);
    }
}
