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

    public function testDerivesA32ByteKeyFromALongPassphrase(): void
    {
        $raw = self::valid();
        $raw['app_key'] = str_repeat('Ab3$', 10);

        $key = Config::fromArray($raw)->appKey;

        self::assertSame(SODIUM_CRYPTO_SECRETBOX_KEYBYTES, strlen($key));
        self::assertSame($key, Config::fromArray($raw)->appKey, 'Derivation must be deterministic.');
        $raw['app_key'] = str_repeat('Ab3$', 10) . 'x';
        self::assertNotSame($key, Config::fromArray($raw)->appKey);
    }

    public function testKeepsABase64KeyAsIs(): void
    {
        $bytes = random_bytes(32);
        $raw = self::valid();
        $raw['app_key'] = base64_encode($bytes);

        self::assertSame($bytes, Config::fromArray($raw)->appKey);
    }

    public function testRejectsShortPassphrase(): void
    {
        $raw = self::valid();
        $raw['app_key'] = str_repeat('a', Config::MIN_PASSPHRASE_LENGTH - 1);

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testGithubSectionIsOptionalAndValidated(): void
    {
        self::assertNull(Config::fromArray(self::valid())->github);

        $raw = self::valid();
        $raw['github'] = ['client_id' => 'Iv23abc', 'private_key_file' => '/x/app.pem', 'accounts' => ['Steuten-IT-Solutions', 'ChrisSteuten']];
        $github = Config::fromArray($raw)->github;
        self::assertNotNull($github);
        self::assertSame('https://api.github.com', $github['api_base']);
        self::assertSame(['Steuten-IT-Solutions', 'ChrisSteuten'], $github['accounts']);

        $raw['github']['accounts'] = ['not a login!'];
        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testVercelSectionIsOptionalAndValidated(): void
    {
        $raw = self::valid();
        $raw['vercel'] = ['token' => 'abc', 'team_id' => 'team_jkt3tKFdYxXmWsEi0Wigz9a7'];
        $vercel = Config::fromArray($raw)->vercel;
        self::assertNotNull($vercel);
        self::assertSame('https://api.vercel.com', $vercel['api_base']);

        $raw['vercel']['team_id'] = 'steuten';
        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }

    public function testStatusReportsSectionIsOptionalAndValidated(): void
    {
        self::assertNull(Config::fromArray(self::valid())->statusReports);

        $raw = self::valid();
        $raw['status_reports'] = ['org' => 'Steuten-IT-Solutions'];
        self::assertSame(['org' => 'Steuten-IT-Solutions'], Config::fromArray($raw)->statusReports);

        $raw['status_reports']['org'] = 'a/b';
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
