<?php

declare(strict_types=1);

namespace Cockpit\Auth;

use ParagonIE\ConstantTime\Base32;

/**
 * Time-based one-time passwords (RFC 6238) with HMAC-SHA1, 6 digits, 30 s steps —
 * the parameters every common authenticator app supports.
 */
final class Totp
{
    public const PERIOD = 30;
    public const DIGITS = 6;

    /** Accepted clock drift in steps on either side of the current one. */
    private const WINDOW = 1;

    public static function generateSecret(): string
    {
        // 160 bits, the shared-secret length RFC 4226 recommends.
        return Base32::encodeUpperUnpadded(random_bytes(20));
    }

    public static function provisioningUri(string $secret, string $account, string $issuer): string
    {
        return sprintf(
            'otpauth://totp/%s:%s?%s',
            rawurlencode($issuer),
            rawurlencode($account),
            http_build_query([
                'secret' => $secret,
                'issuer' => $issuer,
                'algorithm' => 'SHA1',
                'digits' => self::DIGITS,
                'period' => self::PERIOD,
            ], '', '&', PHP_QUERY_RFC3986),
        );
    }

    public static function codeAt(string $secret, int $step): string
    {
        $key = Base32::decodeUpper(strtoupper($secret));
        $hmac = hash_hmac('sha1', pack('J', $step), $key, true);
        $offset = ord($hmac[19]) & 0x0f;
        $binary = ((ord($hmac[$offset]) & 0x7f) << 24)
            | (ord($hmac[$offset + 1]) << 16)
            | (ord($hmac[$offset + 2]) << 8)
            | ord($hmac[$offset + 3]);

        return str_pad((string)($binary % (10 ** self::DIGITS)), self::DIGITS, '0', STR_PAD_LEFT);
    }

    /**
     * Checks a code against the current step and its neighbours.
     *
     * Returns the matched step, or null. A step at or below $lastUsedStep is rejected,
     * so an intercepted code cannot be replayed.
     */
    public static function verify(string $secret, string $code, int $timestamp, ?int $lastUsedStep): ?int
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (!preg_match('/^\d{' . self::DIGITS . '}$/', $code)) {
            return null;
        }

        $current = intdiv($timestamp, self::PERIOD);
        $matched = null;
        // Check every candidate so the duration does not reveal which one matched.
        for ($step = $current - self::WINDOW; $step <= $current + self::WINDOW; $step++) {
            if (hash_equals(self::codeAt($secret, $step), $code) && ($lastUsedStep === null || $step > $lastUsedStep)) {
                $matched ??= $step;
            }
        }

        return $matched;
    }
}
