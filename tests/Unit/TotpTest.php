<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Auth\Totp;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class TotpTest extends TestCase
{
    /** Base32 of the ASCII secret "12345678901234567890" from RFC 6238, Appendix B. */
    private const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    /**
     * RFC 6238 Appendix B lists 8-digit SHA-1 values; a 6-digit code is the same
     * truncated value modulo 10^6, i.e. its last six digits.
     *
     * @return iterable<string, array{int, string}>
     */
    public static function rfcVectors(): iterable
    {
        yield 'T=59' => [59, '287082'];
        yield 'T=1111111109' => [1111111109, '081804'];
        yield 'T=1111111111' => [1111111111, '050471'];
        yield 'T=1234567890' => [1234567890, '005924'];
        yield 'T=2000000000' => [2000000000, '279037'];
        yield 'T=20000000000' => [20000000000, '353130'];
    }

    #[DataProvider('rfcVectors')]
    public function testMatchesRfc6238Vectors(int $timestamp, string $expected): void
    {
        self::assertSame($expected, Totp::codeAt(self::RFC_SECRET, intdiv($timestamp, Totp::PERIOD)));
    }

    public function testVerifyAcceptsAdjacentStepsAndReturnsTheMatchedStep(): void
    {
        $now = 1111111111;
        $step = intdiv($now, Totp::PERIOD);

        self::assertSame($step, Totp::verify(self::RFC_SECRET, Totp::codeAt(self::RFC_SECRET, $step), $now, null));
        self::assertSame($step - 1, Totp::verify(self::RFC_SECRET, Totp::codeAt(self::RFC_SECRET, $step - 1), $now, null));
        self::assertSame($step + 1, Totp::verify(self::RFC_SECRET, Totp::codeAt(self::RFC_SECRET, $step + 1), $now, null));
        self::assertNull(Totp::verify(self::RFC_SECRET, Totp::codeAt(self::RFC_SECRET, $step - 2), $now, null));
    }

    public function testVerifyRejectsReplayOfAnUsedStep(): void
    {
        $now = 1234567890;
        $step = intdiv($now, Totp::PERIOD);
        $code = Totp::codeAt(self::RFC_SECRET, $step);

        self::assertNull(Totp::verify(self::RFC_SECRET, $code, $now, $step));
        self::assertNull(Totp::verify(self::RFC_SECRET, $code, $now, $step + 1));
        self::assertSame($step, Totp::verify(self::RFC_SECRET, $code, $now, $step - 1));
    }

    public function testVerifyIgnoresWhitespaceAndRejectsMalformedInput(): void
    {
        $now = 59;
        $code = Totp::codeAt(self::RFC_SECRET, 1);

        self::assertSame(1, Totp::verify(self::RFC_SECRET, substr($code, 0, 3) . ' ' . substr($code, 3), $now, null));
        self::assertNull(Totp::verify(self::RFC_SECRET, '12345', $now, null));
        self::assertNull(Totp::verify(self::RFC_SECRET, 'abcdef', $now, null));
        self::assertNull(Totp::verify(self::RFC_SECRET, '', $now, null));
    }

    public function testGeneratedSecretsAre160BitBase32(): void
    {
        $secret = Totp::generateSecret();

        self::assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        self::assertNotSame($secret, Totp::generateSecret());
    }

    public function testProvisioningUriContainsIssuerAndParameters(): void
    {
        $uri = Totp::provisioningUri('ABC', 'chris', 'Steuten IT Cockpit');

        self::assertStringStartsWith('otpauth://totp/Steuten%20IT%20Cockpit:chris?', $uri);
        self::assertStringContainsString('secret=ABC', $uri);
        self::assertStringContainsString('issuer=Steuten%20IT%20Cockpit', $uri);
        self::assertStringContainsString('digits=6', $uri);
        self::assertStringContainsString('period=30', $uri);
    }
}
