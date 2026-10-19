<?php

declare(strict_types=1);

namespace Cockpit\Security;

final class Headers
{
    /**
     * @return array<string, string>
     */
    public static function all(bool $secure): array
    {
        $headers = [
            // Scripts and styles only from our own origin; the TOTP QR code is a data: image.
            'Content-Security-Policy' => "default-src 'self'; script-src 'self'; style-src 'self'; "
                . "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
                . "form-action 'self'; base-uri 'none'; object-src 'none'",
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
            'Cross-Origin-Opener-Policy' => 'same-origin',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=(), payment=()',
            'X-Robots-Tag' => 'noindex, nofollow',
            'Cache-Control' => 'no-store',
        ];

        if ($secure) {
            $headers['Strict-Transport-Security'] = 'max-age=31536000';
        }

        return $headers;
    }

    public static function send(bool $secure): void
    {
        foreach (self::all($secure) as $name => $value) {
            header($name . ': ' . $value);
        }
    }
}
