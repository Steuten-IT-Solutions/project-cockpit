<?php

declare(strict_types=1);

namespace Cockpit;

use RuntimeException;

/**
 * Hardened PHP session: files outside the web root, strict cookie flags,
 * idle and absolute timeouts, ID regeneration on privilege changes.
 */
final class Session
{
    public function __construct(
        private readonly string $savePath,
        private readonly bool $secure,
        private readonly int $idleTimeout,
        private readonly int $absoluteTimeout,
    ) {
    }

    public function start(): void
    {
        if (!is_dir($this->savePath) && !mkdir($this->savePath, 0700, true) && !is_dir($this->savePath)) {
            throw new RuntimeException('Session directory could not be created.');
        }

        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string)$this->absoluteTimeout);
        // Some hosts disable PHP's own session cleanup; ours lives in var/, so keep it on.
        ini_set('session.gc_probability', '1');
        ini_set('session.gc_divisor', '100');
        session_save_path($this->savePath);
        // The __Host- prefix makes browsers refuse the cookie unless it is Secure,
        // host-only and path=/, so no other subdomain can set or read it.
        session_name($this->secure ? '__Host-cockpit' : 'cockpit_dev');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $this->secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();

        $now = time();
        $created = $_SESSION['_created'] ?? null;
        $seen = $_SESSION['_seen'] ?? null;
        if (is_int($created) && is_int($seen)
            && ($now - $seen > $this->idleTimeout || $now - $created > $this->absoluteTimeout)) {
            $this->destroy();
            session_start();
        }
        if (!is_int($_SESSION['_created'] ?? null)) {
            $_SESSION['_created'] = $now;
        }
        $_SESSION['_seen'] = $now;
    }

    /**
     * New session ID, same data. Call whenever the authentication state changes.
     */
    public function regenerate(): void
    {
        session_regenerate_id(true);
        $_SESSION['_created'] = time();
    }

    public function destroy(): void
    {
        $_SESSION = [];
        session_destroy();
    }

    public function get(string $key): mixed
    {
        return $_SESSION[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public function remove(string $key): void
    {
        unset($_SESSION[$key]);
    }

    /**
     * One-time message for the next page.
     */
    public function flash(?string $message = null): ?string
    {
        if ($message !== null) {
            $_SESSION['_flash'] = $message;

            return null;
        }
        $stored = $_SESSION['_flash'] ?? null;
        unset($_SESSION['_flash']);

        return is_string($stored) ? $stored : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function &data(): array
    {
        return $_SESSION;
    }
}
