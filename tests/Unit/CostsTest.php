<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Costs\Cost;
use Cockpit\Vercel\BillingSync;
use Cockpit\Vercel\Charges;
use Cockpit\Vercel\Client;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class CostsTest extends TestCase
{
    public function testParsesGermanAndEnglishAmounts(): void
    {
        self::assertSame(1299, Cost::parseAmount('12,99'));
        self::assertSame(1299, Cost::parseAmount('12.99'));
        self::assertSame(1250, Cost::parseAmount('12,5'));
        self::assertSame(2000, Cost::parseAmount(' 20 '));
        self::assertSame(120050, Cost::parseAmount('1.200,50'));
        self::assertSame(120000, Cost::parseAmount('1.200'), 'A dot before three digits is a thousands separator.');
        self::assertSame(0, Cost::parseAmount('0'));
        foreach (['', 'abc', '-5', '12,999', '1e3', '12345678', '1,2,3'] as $bad) {
            self::assertNull(Cost::parseAmount($bad), $bad);
        }
    }

    public function testValidatesTheForm(): void
    {
        $form = ['name' => '  Domain  ', 'provider' => 'IONOS', 'amount' => '12,00', 'currency' => 'EUR', 'interval' => 'year', 'project' => '7', 'note' => ''];

        $cost = Cost::fromForm($form, [7]);
        self::assertSame([
            'name' => 'Domain',
            'provider' => 'IONOS',
            'amount_cents' => 1200,
            'currency' => 'EUR',
            'billing_interval' => 'year',
            'project_id' => 7,
            'note' => null,
        ], $cost);

        self::assertIsString(Cost::fromForm(['name' => ' '] + $form, [7]));
        self::assertIsString(Cost::fromForm(['amount' => 'zwölf'] + $form, [7]));
        self::assertIsString(Cost::fromForm(['currency' => 'GBP'] + $form, [7]));
        self::assertIsString(Cost::fromForm(['interval' => 'week'] + $form, [7]));
        self::assertIsString(Cost::fromForm(['project' => '8'] + $form, [7]), 'Only known projects may be linked.');
        self::assertIsArray(Cost::fromForm(['project' => ''] + $form, []));
    }

    public function testTotalsPerCurrencyWithoutConversion(): void
    {
        $totals = Cost::totals([
            ['amount_cents' => 1200, 'currency' => 'EUR', 'billing_interval' => 'year'],
            ['amount_cents' => 899, 'currency' => 'EUR', 'billing_interval' => 'month'],
            ['amount_cents' => 2000, 'currency' => 'USD', 'billing_interval' => 'month'],
        ]);

        self::assertSame(['EUR', 'USD'], array_keys($totals));
        self::assertEqualsWithDelta(999.0, $totals['EUR']['month'], 0.0001);
        self::assertEqualsWithDelta(11988.0, $totals['EUR']['year'], 0.0001);
        self::assertEqualsWithDelta(24000.0, $totals['USD']['year'], 0.0001);
        self::assertSame("1.234,50\u{00A0}€", Cost::money(123450, 'EUR'));
        self::assertSame("20,00\u{00A0}US$", Cost::money(2000, 'USD'));
    }

    public function testAggregatesFocusCharges(): void
    {
        $jsonl = implode("\n", [
            '{"BilledCost":"1.25","EffectiveCost":"1.25","BillingCurrency":"USD","ChargeCategory":"Usage","ServiceName":"Fast Data Transfer","Tags":{"ProjectId":"prj_1","ProjectName":"toolbox-hub"}}',
            '{"BilledCost":0.75,"EffectiveCost":0.5,"BillingCurrency":"USD","ChargeCategory":"Usage","ServiceName":"Fast Data Transfer","Tags":{"ProjectId":"prj_1","ProjectName":"toolbox-hub"}}',
            '{"BilledCost":"20","BillingCurrency":"USD","ChargeCategory":"Purchase","ServiceName":"Pro Plan","Tags":{}}',
            '',
            '{"BilledCost":"-2","BillingCurrency":"USD","ChargeCategory":"Mystery","ServiceName":"Credit\u0007","Tags":{"x_ProjectName":"garden"}}',
        ]);

        $sums = Charges::aggregate($jsonl . "\n");

        self::assertCount(3, $sums);
        self::assertSame('toolbox-hub', $sums[0]['project']);
        self::assertEqualsWithDelta(2.0, $sums[0]['billed_cost'], 1e-9);
        self::assertEqualsWithDelta(1.75, $sums[0]['effective_cost'], 1e-9);
        self::assertSame('Purchase', $sums[1]['category']);
        self::assertNull($sums[1]['project']);
        self::assertEqualsWithDelta(20.0, $sums[1]['effective_cost'], 1e-9, 'EffectiveCost falls back to BilledCost.');
        self::assertSame('Other', $sums[2]['category']);
        self::assertSame('Credit', $sums[2]['service'], 'Control characters are stripped.');
        self::assertSame('garden', $sums[2]['project']);
        self::assertSame([], Charges::aggregate(''));
    }

    public function testRejectsUnexpectedChargeLines(): void
    {
        $this->expectException(RuntimeException::class);
        Charges::aggregate('{"BilledCost":"abc","BillingCurrency":"USD"}');
    }

    public function testRejectsNonJsonLines(): void
    {
        $this->expectException(RuntimeException::class);
        Charges::aggregate("<html>");
    }

    public function testBillingPeriodIsTheCalendarMonthUntilTomorrow(): void
    {
        self::assertSame(['2026-10-01', '2026-10-20'], BillingSync::period(1792420000)); // 2026-10-19 UTC
        self::assertSame(['2026-10-01', '2026-11-01'], BillingSync::period(1793487600)); // 2026-10-31 23:00 UTC
    }

    public function testRawRequestCarriesTeamAndAccept(): void
    {
        $seenUrl = '';
        $seenHeaders = [];
        $client = new Client('tok', 'team_x', 'https://api.example', static function (string $url, array $headers) use (&$seenUrl, &$seenHeaders): array {
            $seenUrl = $url;
            $seenHeaders = $headers;

            return [200, "{}\n"];
        });

        self::assertSame([200, "{}\n"], $client->getRaw('/v1/billing/charges', ['from' => '2026-10-01T00:00:00.000Z'], 'application/jsonl'));
        self::assertSame('https://api.example/v1/billing/charges?from=2026-10-01T00%3A00%3A00.000Z&teamId=team_x', $seenUrl);
        self::assertContains('Accept: application/jsonl', $seenHeaders);
        self::assertContains('Authorization: Bearer tok', $seenHeaders);
    }
}
