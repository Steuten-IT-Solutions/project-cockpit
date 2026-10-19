<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Security\Crypto;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class CryptoTest extends TestCase
{
    public function testEncryptRoundTripsAndUsesFreshNonces(): void
    {
        $crypto = new Crypto(random_bytes(32));
        $a = $crypto->encrypt('secret');

        self::assertSame('secret', $crypto->decrypt($a));
        self::assertNotSame($a, $crypto->encrypt('secret'));
    }

    public function testTamperedCiphertextIsRejected(): void
    {
        $crypto = new Crypto(random_bytes(32));
        $raw = base64_decode($crypto->encrypt('secret'), true);
        self::assertIsString($raw);
        $raw[strlen($raw) - 1] = chr(ord($raw[strlen($raw) - 1]) ^ 1);

        $this->expectException(RuntimeException::class);
        $crypto->decrypt(base64_encode($raw));
    }

    public function testCiphertextFromAnotherKeyIsRejected(): void
    {
        $encrypted = (new Crypto(random_bytes(32)))->encrypt('secret');

        $this->expectException(RuntimeException::class);
        (new Crypto(random_bytes(32)))->decrypt($encrypted);
    }

    public function testHashSeparatesPurposes(): void
    {
        $crypto = new Crypto(str_repeat('k', 32));

        self::assertSame($crypto->hash('ip', '1.2.3.4'), $crypto->hash('ip', '1.2.3.4'));
        self::assertNotSame($crypto->hash('ip', '1.2.3.4'), $crypto->hash('recovery', '1.2.3.4'));
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $crypto->hash('ip', 'x'));
    }

    public function testRejectsWrongKeyLength(): void
    {
        $this->expectException(RuntimeException::class);
        new Crypto('short');
    }
}
