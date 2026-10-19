<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\GitHub\Client;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class GitHubClientTest extends TestCase
{
    private static string $privateKey = '';
    private static string $publicKey = '';

    public static function setUpBeforeClass(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($key);
        openssl_pkey_export($key, $pem);
        self::$privateKey = (string)$pem;
        $details = openssl_pkey_get_details($key);
        self::$publicKey = is_array($details) ? (string)$details['key'] : '';
    }

    private static function decode(string $segment): string
    {
        return (string)base64_decode(strtr($segment, '-_', '+/'), true);
    }

    public function testJwtIsRs256SignedWithClientIdAndShortLifetime(): void
    {
        $jwt = (new Client('Iv23test', self::$privateKey))->jwt(1_000_000);
        $parts = explode('.', $jwt);
        self::assertCount(3, $parts);

        self::assertSame(['alg' => 'RS256', 'typ' => 'JWT'], json_decode(self::decode($parts[0]), true));
        self::assertSame(['iat' => 999_940, 'exp' => 1_000_540, 'iss' => 'Iv23test'], json_decode(self::decode($parts[1]), true));
        self::assertSame(1, openssl_verify($parts[0] . '.' . $parts[1], self::decode($parts[2]), self::$publicKey, OPENSSL_ALGO_SHA256));
    }

    public function testInvalidKeyIsRejected(): void
    {
        $this->expectException(RuntimeException::class);
        (new Client('Iv23test', 'not a key'))->jwt(1);
    }

    public function testPaginateFollowsLinkHeaderAndSendsHeaders(): void
    {
        $calls = [];
        $transport = static function (string $method, string $url, array $headers) use (&$calls): array {
            $calls[] = [$method, $url, $headers];
            if (str_contains($url, 'page=2')) {
                return [200, [], (string)json_encode(['repositories' => [['id' => 2]]])];
            }

            return [200, ['link' => '<https://api.github.com/installation/repositories?page=2>; rel="next", <https://api.github.com/installation/repositories?page=2>; rel="last"'],
                (string)json_encode(['repositories' => [['id' => 1]]])];
        };
        $client = new Client('Iv23test', self::$privateKey, 'https://api.github.com', $transport(...));

        $items = $client->paginate('/installation/repositories?per_page=100', 'tok', 'repositories');

        self::assertSame([['id' => 1], ['id' => 2]], $items);
        self::assertCount(2, $calls);
        self::assertSame('https://api.github.com/installation/repositories?per_page=100', $calls[0][1]);
        self::assertContains('Authorization: Bearer tok', $calls[0][2]);
        self::assertContains('X-GitHub-Api-Version: 2026-03-10', $calls[0][2]);
    }

    public function testRefusesToSendTheTokenToAnotherHost(): void
    {
        $transport = static fn (string $m, string $u, array $h): array => [200, ['link' => '<https://evil.example/steal>; rel="next"'], '[]'];
        $client = new Client('Iv23test', self::$privateKey, 'https://api.github.com', $transport(...));

        $this->expectException(RuntimeException::class);
        $client->paginate('/app/installations', 'tok');
    }

    public function testInstallationsAndTokens(): void
    {
        $transport = static function (string $method, string $url, array $headers): array {
            if ($method === 'GET' && str_ends_with(strtok($url, '?') ?: '', '/app/installations')) {
                return [200, [], (string)json_encode([
                    ['id' => 11, 'account' => ['login' => 'Steuten-IT-Solutions']],
                    ['id' => 12, 'account' => ['login' => 'ChrisSteuten']],
                ])];
            }
            if ($method === 'POST' && str_ends_with($url, '/app/installations/11/access_tokens')) {
                return [201, [], (string)json_encode(['token' => 'ghs_abc'])];
            }

            return [404, [], '{}'];
        };
        $client = new Client('Iv23test', self::$privateKey, 'https://api.github.com', $transport(...));

        self::assertSame([['id' => 11, 'account' => 'Steuten-IT-Solutions'], ['id' => 12, 'account' => 'ChrisSteuten']], $client->installations(1000));
        self::assertSame('ghs_abc', $client->installationToken(11, 1000));

        $this->expectException(RuntimeException::class);
        $client->installationToken(99, 1000);
    }

    public function testNextLinkParsing(): void
    {
        self::assertNull(Client::nextLink(''));
        self::assertNull(Client::nextLink('<https://api.github.com/x?page=1>; rel="prev"'));
        self::assertSame('https://api.github.com/x?page=3', Client::nextLink('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next"'));
    }
}
