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
        );
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
