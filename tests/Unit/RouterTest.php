<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Http\Request;
use Cockpit\Http\Response;
use Cockpit\Http\Router;
use PHPUnit\Framework\TestCase;

final class RouterTest extends TestCase
{
    private static function request(string $method, string $path): Request
    {
        return new Request($method, $path, [], [], '127.0.0.1', true);
    }

    public function testDispatchesByMethodAndPath(): void
    {
        $router = new Router();
        $router->add('GET', '/a', static fn (): Response => new Response(200, 'get'));
        $router->add('POST', '/a', static fn (): Response => new Response(200, 'post'));

        self::assertSame('get', $router->dispatch(self::request('GET', '/a'))->body);
        self::assertSame('post', $router->dispatch(self::request('POST', '/a'))->body);
    }

    public function testUnknownPathIs404AndWrongMethodIs405(): void
    {
        $router = new Router();
        $router->add('GET', '/a', static fn (): Response => new Response(200));

        self::assertSame(404, $router->dispatch(self::request('GET', '/b'))->status);
        $response = $router->dispatch(self::request('DELETE', '/a'));
        self::assertSame(405, $response->status);
        self::assertSame('GET', $response->headers['Allow']);
    }
}
