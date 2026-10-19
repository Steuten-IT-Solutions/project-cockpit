<?php

declare(strict_types=1);

namespace Cockpit\Security;

/**
 * Synchroniser token stored in the session, checked on every state-changing request.
 */
final class Csrf
{
    private const KEY = '_csrf';

    /**
     * @param array<string, mixed> $session the session array, passed by reference
     */
    public static function token(array &$session): string
    {
        $token = $session[self::KEY] ?? null;
        if (!is_string($token) || strlen($token) !== 64) {
            $token = bin2hex(random_bytes(32));
            $session[self::KEY] = $token;
        }

        return $token;
    }

    /**
     * @param array<string, mixed> $session
     */
    public static function isValid(array $session, mixed $submitted): bool
    {
        $token = $session[self::KEY] ?? null;

        return is_string($token) && is_string($submitted) && $token !== '' && hash_equals($token, $submitted);
    }
}
