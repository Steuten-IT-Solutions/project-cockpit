<?php

declare(strict_types=1);

namespace Cockpit\Notify;

use Closure;
use RuntimeException;

/**
 * Web push without payload (RFC 8030) with VAPID (RFC 8292). The service worker shows a fixed
 * notification and opens the alerts page; the details stay behind the login. Without payload there
 * is nothing to encrypt, so only the VAPID token (ES256 JWT) is needed.
 *
 * The key is an EC P-256 private key in PEM, e.g. from
 *   openssl ecparam -name prime256v1 -genkey -noout -out config/vapid.pem
 */
final class WebPush
{
    /** Seconds a push service keeps an undelivered message. */
    private const TTL = 86400;

    private readonly \OpenSSLAsymmetricKey $key;
    private readonly string $publicKey;
    /** @var Closure(string, array<string, string>): int */
    private readonly Closure $transport;

    /**
     * @param string $subject contact for the push services, "mailto:…" or "https://…"
     * @param (Closure(string, array<string, string>): int)|null $transport POSTs an empty body, returns the HTTP status
     */
    public function __construct(string $pem, private readonly string $subject, ?Closure $transport = null)
    {
        $key = openssl_pkey_get_private($pem);
        $details = $key === false ? false : openssl_pkey_get_details($key);
        if ($key === false || $details === false || ($details['ec']['curve_name'] ?? '') !== 'prime256v1') {
            throw new RuntimeException('The VAPID key must be an EC P-256 private key in PEM.');
        }
        $this->key = $key;
        $this->publicKey = self::base64url("\x04" . self::pad($details['ec']['x']) . self::pad($details['ec']['y']));
        $this->transport = $transport ?? self::curl(...);
    }

    /** Public key (uncompressed point, base64url) for pushManager.subscribe() in the browser. */
    public function publicKey(): string
    {
        return $this->publicKey;
    }

    /**
     * Sends a push to one subscription. Returns the HTTP status (201 delivered; 404 and 410 mean the
     * subscription is gone and should be removed).
     */
    public function send(string $endpoint, int $now): int
    {
        $parts = parse_url($endpoint);
        if (!self::validEndpoint($endpoint) || !is_array($parts) || !isset($parts['host'])) {
            throw new RuntimeException('Invalid push endpoint.');
        }
        $audience = 'https://' . $parts['host'];

        return ($this->transport)($endpoint, [
            'TTL' => (string)self::TTL,
            'Urgency' => 'high',
            'Authorization' => 'vapid t=' . $this->token($audience, $now) . ', k=' . $this->publicKey,
            'Content-Length' => '0',
        ]);
    }

    /** Hosts of the push services of Chrome/Android, Firefox, Safari/iOS and Edge/Windows. */
    private const PUSH_HOSTS = ['/^fcm\.googleapis\.com$/', '/(^|\.)push\.services\.mozilla\.com$/', '/(^|\.)push\.apple\.com$/', '/(^|\.)notify\.windows\.com$/'];

    /** Only https endpoints of the known push services, without credentials. */
    public static function validEndpoint(string $endpoint): bool
    {
        $parts = parse_url($endpoint);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['port']) || strlen($endpoint) > 500) {
            return false;
        }
        $host = strtolower($parts['host'] ?? '');
        foreach (self::PUSH_HOSTS as $pattern) {
            if (preg_match($pattern, $host)) {
                return true;
            }
        }

        return false;
    }

    /** VAPID JWT (ES256), valid for 12 hours. */
    public function token(string $audience, int $now): string
    {
        $header = self::base64url((string)json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $claims = self::base64url((string)json_encode(['aud' => $audience, 'exp' => $now + 12 * 3600, 'sub' => $this->subject], JSON_UNESCAPED_SLASHES));
        $input = $header . '.' . $claims;
        if (!openssl_sign($input, $der, $this->key, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('VAPID token could not be signed.');
        }

        return $input . '.' . self::base64url(self::derToRaw($der));
    }

    /**
     * ECDSA signature from DER (SEQUENCE of two INTEGERs) to the raw r||s form of JWS (64 bytes).
     */
    public static function derToRaw(string $der): string
    {
        $pos = 2;
        if (ord($der[1]) & 0x80) {
            $pos += ord($der[1]) & 0x7f;
        }
        $out = '';
        for ($i = 0; $i < 2; $i++) {
            if (ord($der[$pos]) !== 0x02) {
                throw new RuntimeException('Unexpected signature format.');
            }
            $len = ord($der[$pos + 1]);
            $int = substr($der, $pos + 2, $len);
            $out .= self::pad(ltrim($int, "\x00"));
            $pos += 2 + $len;
        }

        return $out;
    }

    public static function base64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /** Left-pads a big-endian number to 32 bytes. */
    private static function pad(string $bytes): string
    {
        return str_pad($bytes, 32, "\x00", STR_PAD_LEFT);
    }

    /**
     * @param array<string, string> $headers
     */
    private static function curl(string $endpoint, array $headers): int
    {
        $ch = curl_init($endpoint);
        if ($ch === false) {
            throw new RuntimeException('curl could not be initialised.');
        }
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => '',
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $result = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false) {
            throw new RuntimeException('Push fehlgeschlagen: ' . $error);
        }

        return $status;
    }
}
