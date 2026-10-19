<?php

declare(strict_types=1);

namespace Cockpit\Http;

/**
 * Exact-match router: METHOD + path → handler. Enough for a handful of pages.
 */
final class Router
{
    /** @var array<string, array<string, callable(Request): Response>> */
    private array $routes = [];

    /**
     * @param callable(Request): Response $handler
     */
    public function add(string $method, string $path, callable $handler): void
    {
        $this->routes[$path][strtoupper($method)] = $handler;
    }

    public function dispatch(Request $request): Response
    {
        $byMethod = $this->routes[$request->path] ?? null;
        if ($byMethod === null) {
            return new Response(404);
        }

        $handler = $byMethod[$request->method] ?? null;
        if ($handler === null) {
            return new Response(405, '', ['Allow' => implode(', ', array_keys($byMethod))]);
        }

        return $handler($request);
    }
}
