<?php

declare(strict_types=1);

namespace Cockpit\Mcp;

use Cockpit\Http\Request;
use Cockpit\Http\Response;
use JsonException;

/**
 * Feasibility probe for the planned MCP server (no MCP protocol yet). It answers what an MCP client sees first:
 *
 * - GET /.well-known/oauth-protected-resource[/mcp]: Protected Resource Metadata (RFC 9728), proving that the host
 *   serves /.well-known/ through the front controller.
 * - POST /mcp without a token: 401 with WWW-Authenticate pointing at that metadata.
 * - POST /mcp with "Authorization: Bearer <probe_token>": 200, proving that the Authorization header reaches PHP,
 *   and naming the server variable it arrived in. The token itself is never echoed.
 *
 * Without an mcp section in config.php every path answers 404.
 */
final class Probe
{
    public const ENDPOINT = '/mcp';
    public const METADATA = '/.well-known/oauth-protected-resource';

    /**
     * @param array{probe_token: ?string}|null $config
     */
    public function __construct(private readonly string $baseUrl, private readonly ?array $config)
    {
    }

    public static function handles(string $path): bool
    {
        return in_array($path, [self::ENDPOINT, self::METADATA, self::METADATA . self::ENDPOINT], true);
    }

    public function handle(Request $request): Response
    {
        if ($this->config === null) {
            return self::json(404, ['error' => 'not_found']);
        }

        if ($request->path === self::ENDPOINT) {
            if ($request->method !== 'POST') {
                return self::json(405, ['error' => 'method_not_allowed'], ['Allow' => 'POST']);
            }

            return $this->endpoint($request);
        }

        if ($request->method !== 'GET') {
            return self::json(405, ['error' => 'method_not_allowed'], ['Allow' => 'GET']);
        }

        return self::json(200, [
            'resource' => $this->baseUrl . self::ENDPOINT,
            'bearer_methods_supported' => ['header'],
            'scopes_supported' => ['cockpit:read'],
            'resource_name' => 'Steuten IT Cockpit',
        ]);
    }

    private function endpoint(Request $request): Response
    {
        $challenge = sprintf('Bearer resource_metadata="%s%s%s"', $this->baseUrl, self::METADATA, self::ENDPOINT);

        if ($request->authorization === '') {
            return self::json(401, [
                'error' => 'unauthorized',
                'detail' => 'No Authorization header reached PHP.',
            ], ['WWW-Authenticate' => $challenge]);
        }

        $token = preg_match('/^Bearer ([A-Za-z0-9._~+\/-]+=*)$/D', $request->authorization, $m) === 1 ? $m[1] : '';
        $expected = $this->config['probe_token'] ?? null;
        if ($expected === null || $token === '' || !hash_equals($expected, $token)) {
            return self::json(401, [
                'error' => 'invalid_token',
                'detail' => 'An Authorization header reached PHP, but it does not hold the probe token.',
                'header_source' => $request->authorizationSource,
            ], ['WWW-Authenticate' => $challenge . ', error="invalid_token"']);
        }

        return self::json(200, [
            'probe' => 'ok',
            'detail' => 'The Authorization header reached PHP with the probe token.',
            'header_source' => $request->authorizationSource,
        ]);
    }

    /**
     * @param array<string, mixed> $body
     * @param array<string, string> $headers
     */
    private static function json(int $status, array $body, array $headers = []): Response
    {
        try {
            $json = json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            $json = '{"error":"internal"}';
        }

        return new Response($status, $json . "\n", ['Content-Type' => 'application/json'] + $headers);
    }
}
