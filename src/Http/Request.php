<?php

declare(strict_types=1);

namespace Cockpit\Http;

final class Request
{
    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed> $post
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly array $query,
        private readonly array $post,
        public readonly string $clientIp,
        public readonly bool $secure,
        public readonly string $authorization = '',
        public readonly string $authorizationSource = '',
    ) {
    }

    public static function fromGlobals(): self
    {
        $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $path = is_string($path) && $path !== '' ? $path : '/';
        if ($path !== '/') {
            $path = rtrim($path, '/');
        }

        return new self(
            strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path,
            $_GET,
            $_POST,
            // REMOTE_ADDR only: forwarding headers can be set by any client.
            (string)($_SERVER['REMOTE_ADDR'] ?? ''),
            (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
            ...self::authorizationFrom($_SERVER),
        );
    }

    /**
     * The Authorization header and where PHP found it. Under CGI/FastCGI Apache hides the header from PHP;
     * public/.htaccess copies it into the environment, which PHP sees as HTTP_AUTHORIZATION, or as
     * REDIRECT_HTTP_AUTHORIZATION after the rewrite to index.php.
     *
     * @param array<mixed> $server
     * @return array{authorization: string, authorizationSource: string}
     */
    public static function authorizationFrom(array $server): array
    {
        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
            $value = $server[$key] ?? null;
            if (is_string($value) && $value !== '') {
                return ['authorization' => $value, 'authorizationSource' => $key];
            }
        }

        return ['authorization' => '', 'authorizationSource' => ''];
    }

    public function query(string $key): string
    {
        $value = $this->query[$key] ?? '';

        return is_string($value) ? $value : '';
    }

    public function input(string $key): string
    {
        $value = $this->post[$key] ?? '';

        return is_string($value) ? $value : '';
    }
}
