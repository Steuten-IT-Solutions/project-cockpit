<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use RuntimeException;

/**
 * Reads the team's charges of the current calendar month (UTC) from
 * GET /v1/billing/charges and stores them summed per service, category and project.
 */
final class BillingSync
{
    public function __construct(private readonly Client $client, private readonly BillingRepository $store)
    {
    }

    /**
     * @return array<string, float> billed cost per currency
     */
    public function run(int $now): array
    {
        [$from, $to] = self::period($now);
        [$status, $body] = $this->client->getRaw('/v1/billing/charges', [
            'from' => $from . 'T00:00:00.000Z',
            'to' => $to . 'T00:00:00.000Z',
        ], 'application/jsonl, application/json');
        if ($status !== 200) {
            throw new RuntimeException(sprintf(
                'Vercel returned %d for /v1/billing/charges%s.',
                $status,
                Client::reason(json_decode($body, true)),
            ));
        }
        $sums = Charges::aggregate($body);
        $this->store->replace($sums, $from, $to, gmdate('Y-m-d H:i:s', $now));

        $totals = [];
        foreach ($sums as $sum) {
            $totals[$sum['currency']] = ($totals[$sum['currency']] ?? 0.0) + $sum['billed_cost'];
        }

        return $totals;
    }

    /**
     * First day of the month and the day after today (exclusive end), both UTC dates.
     *
     * @return array{string, string}
     */
    public static function period(int $now): array
    {
        return [gmdate('Y-m-01', $now), gmdate('Y-m-d', $now + 86400)];
    }
}
