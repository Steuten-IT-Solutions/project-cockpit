<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Security\Csrf;
use PHPUnit\Framework\TestCase;

final class CsrfTest extends TestCase
{
    public function testTokenIsStableWithinASession(): void
    {
        $session = [];
        $token = Csrf::token($session);

        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $token);
        self::assertSame($token, Csrf::token($session));
        self::assertTrue(Csrf::isValid($session, $token));
    }

    public function testRejectsMissingOrWrongTokens(): void
    {
        $session = [];
        Csrf::token($session);

        self::assertFalse(Csrf::isValid($session, ''));
        self::assertFalse(Csrf::isValid($session, str_repeat('0', 64)));
        self::assertFalse(Csrf::isValid($session, ['array']));
        self::assertFalse(Csrf::isValid([], 'anything'));
    }
}
