<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Auth\RecoveryCodes;
use PHPUnit\Framework\TestCase;

final class RecoveryCodesTest extends TestCase
{
    public function testGeneratesDistinctCodesInTheExpectedFormat(): void
    {
        $codes = RecoveryCodes::generate();

        self::assertCount(RecoveryCodes::COUNT, $codes);
        self::assertCount(RecoveryCodes::COUNT, array_unique($codes));
        foreach ($codes as $code) {
            self::assertMatchesRegularExpression('/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/', $code);
        }
    }

    public function testNormaliseIgnoresCaseSpacesAndDashes(): void
    {
        self::assertSame('ABCDE23456', RecoveryCodes::normalise(' abcde-23456 '));
        self::assertSame('ABCDE23456', RecoveryCodes::normalise('ABCDE 23456'));
    }
}
