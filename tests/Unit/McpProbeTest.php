<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Config;
use Cockpit\Http\Request;
use Cockpit\Http\Response;
use Cockpit\Mcp\Probe;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class McpProbeTest extends TestCase
{
    private const BASE = 'https://cockpit.example.org';
    private const TOKEN = 'probe-token-0123456789-abcdefghijkl';

    private static function request(string $method, string $path, string $authorization = '', string $source = ''): Request
    {
        return new Request($method, $path, [], [], '127.0.0.1', true, $authorization, $source);
    }

    private static function probe(): Probe
    {
        return new Probe(self::BASE, ['probe_token' => self::TOKEN]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function body(Response $response): array
    {
        $body = json_decode($response->body, true, 8, JSON_THROW_ON_ERROR);
        self::assertIsArray($body);

        /** @var array<string, mixed> $body */
        return $body;
    }

    public function testHandlesOnlyItsOwnPaths(): void
    {
        self::assertTrue(Probe::handles('/mcp'));
        self::assertTrue(Probe::handles('/.well-known/oauth-protected-resource'));
        self::assertTrue(Probe::handles('/.well-known/oauth-protected-resource/mcp'));
        self::assertFalse(Probe::handles('/'));
        self::assertFalse(Probe::handles('/.well-known/oauth-authorization-server'));
        self::assertFalse(Probe::handles('/mcp/x'));
    }

    public function testAnswers404WithoutConfiguration(): void
    {
        $probe = new Probe(self::BASE, null);

        self::assertSame(404, $probe->handle(self::request('POST', '/mcp'))->status);
        self::assertSame(404, $probe->handle(self::request('GET', '/.well-known/oauth-protected-resource/mcp'))->status);
    }

    public function testServesProtectedResourceMetadata(): void
    {
        foreach (['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'] as $path) {
            $response = self::probe()->handle(self::request('GET', $path));

            self::assertSame(200, $response->status);
            self::assertSame('application/json', $response->headers['Content-Type']);
            self::assertSame(self::BASE . '/mcp', self::body($response)['resource']);
        }
    }

    public function testChallengesARequestWithoutToken(): void
    {
        $response = self::probe()->handle(self::request('POST', '/mcp'));

        self::assertSame(401, $response->status);
        self::assertSame(
            'Bearer resource_metadata="https://cockpit.example.org/.well-known/oauth-protected-resource/mcp"',
            $response->headers['WWW-Authenticate'],
        );
        self::assertSame('unauthorized', self::body($response)['error']);
    }

    public function testRejectsAWrongToken(): void
    {
        $response = self::probe()->handle(self::request('POST', '/mcp', 'Bearer wrong-token', 'HTTP_AUTHORIZATION'));

        self::assertSame(401, $response->status);
        self::assertStringEndsWith('error="invalid_token"', $response->headers['WWW-Authenticate']);
        self::assertSame('invalid_token', self::body($response)['error']);
        self::assertStringNotContainsString('wrong-token', $response->body);
    }

    public function testRejectsEveryTokenWhenNoneIsConfigured(): void
    {
        $probe = new Probe(self::BASE, ['probe_token' => null]);

        self::assertSame(401, $probe->handle(self::request('POST', '/mcp', 'Bearer ' . self::TOKEN, 'HTTP_AUTHORIZATION'))->status);
    }

    public function testAcceptsTheProbeTokenAndNamesItsSource(): void
    {
        $response = self::probe()->handle(
            self::request('POST', '/mcp', 'Bearer ' . self::TOKEN, 'REDIRECT_HTTP_AUTHORIZATION')
        );

        self::assertSame(200, $response->status);
        $body = self::body($response);
        self::assertSame('ok', $body['probe']);
        self::assertSame('REDIRECT_HTTP_AUTHORIZATION', $body['header_source']);
        self::assertStringNotContainsString(self::TOKEN, $response->body);
    }

    public function testRefusesOtherMethods(): void
    {
        self::assertSame(405, self::probe()->handle(self::request('GET', '/mcp'))->status);
        self::assertSame(405, self::probe()->handle(self::request('DELETE', '/mcp'))->status);
        self::assertSame(405, self::probe()->handle(self::request('POST', '/.well-known/oauth-protected-resource'))->status);
    }

    public function testFindsTheAuthorizationHeaderInEitherServerVariable(): void
    {
        self::assertSame(
            ['authorization' => 'Bearer a', 'authorizationSource' => 'HTTP_AUTHORIZATION'],
            Request::authorizationFrom(['HTTP_AUTHORIZATION' => 'Bearer a', 'REDIRECT_HTTP_AUTHORIZATION' => 'Bearer b']),
        );
        self::assertSame(
            ['authorization' => 'Bearer b', 'authorizationSource' => 'REDIRECT_HTTP_AUTHORIZATION'],
            Request::authorizationFrom(['HTTP_AUTHORIZATION' => '', 'REDIRECT_HTTP_AUTHORIZATION' => 'Bearer b']),
        );
        self::assertSame(['authorization' => '', 'authorizationSource' => ''], Request::authorizationFrom([]));
    }

    /**
     * @return array<string, mixed>
     */
    private static function config(): array
    {
        return [
            'base_url' => self::BASE,
            'app_key' => base64_encode(str_repeat('k', 32)),
            'setup_token' => '',
            'database' => ['dsn' => 'sqlite::memory:', 'user' => 'u', 'password' => ''],
        ];
    }

    public function testConfigReadsTheMcpSection(): void
    {
        self::assertNull(Config::fromArray(self::config())->mcp);

        $raw = self::config();
        $raw['mcp'] = ['probe_token' => self::TOKEN];
        self::assertSame(['probe_token' => self::TOKEN], Config::fromArray($raw)->mcp);

        $raw['mcp'] = [];
        self::assertSame(['probe_token' => null], Config::fromArray($raw)->mcp);
    }

    public function testConfigRejectsAShortProbeToken(): void
    {
        $raw = self::config();
        $raw['mcp'] = ['probe_token' => 'short'];

        $this->expectException(RuntimeException::class);
        Config::fromArray($raw);
    }
}
