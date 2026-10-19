<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Config;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ConfigTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function valid(): array
    {
        return [
            'base_url' => 'https://cockpit.example.org',
            'app_key' => base64_encode(str_repeat('k', 32)),
            'setup_token' => '',
            'database' => ['dsn' => 'sqlite::memory:', 'user' => 'u', 'password' => ''],
        ];
    }

    public function testAcceptsAValidConfigurationWithDefaults(): void
    {
        $config = Config::fromArray(self::valid());

        self::assertSame('https://cockpit.example.org', $config->baseUrl);
        self::assertSame(7200, $config->idleTimeout);
        self::assertSame(43200, $config->absoluteTimeout);
        self::assertSame('Europe/Berlin', $config->timezone);
    }

    public function testRejectsPlaceholderValues(): void
    {
        $raw = self::valid();
        $raw['database']['dsn'] = 'mysql:host=CHANGE-ME';

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testRejectsShortAppKey(): void
    {
        $raw = self::valid();
        $raw['app_key'] = base64_encode('too-short');

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testRejectsShortSetupToken(): void
    {
        $raw = self::valid();
        $raw['setup_token'] = 'short';

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testRejectsBaseUrlWithPath(): void
    {
        $raw = self::valid();
        $raw['base_url'] = 'https://cockpit.example.org/';

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }
}
