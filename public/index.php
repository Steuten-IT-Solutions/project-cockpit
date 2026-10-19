<?php

declare(strict_types=1);

use Cockpit\App;
use Cockpit\Http\Request;
use Cockpit\Http\Response;
use Cockpit\Security\Headers;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';

ini_set('display_errors', '0');
ini_set('log_errors', '1');

$request = Request::fromGlobals();
Headers::send($request->secure);

try {
    App::boot($root, $request)->handle($request)->send();
} catch (Throwable $e) {
    // Details go to the server log only, never to the browser.
    error_log(sprintf('[cockpit] %s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
    (new Response(500, "Interner Fehler. Details stehen im Fehlerprotokoll des Servers.\n", ['Content-Type' => 'text/plain; charset=utf-8']))->send();
}
