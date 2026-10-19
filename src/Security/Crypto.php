<?php

declare(strict_types=1);

namespace Cockpit\Security;

use RuntimeException;

/**
 * Authenticated encryption (XSalsa20-Poly1305) and keyed hashing with the app key.
 */
final class Crypto
{
    public function __construct(private readonly string $key)
    {
        if (strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            throw new RuntimeException('Invalid key length.');
        }
    }

    public function encrypt(string $plaintext): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        return base64_encode($nonce . sodium_crypto_secretbox($plaintext, $nonce, $this->key));
    }

    public function decrypt(string $encoded): string
    {
        $raw = base64_decode($encoded, true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            throw new RuntimeException('Ciphertext is malformed.');
        }

        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plaintext = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->key);
        if ($plaintext === false) {
            throw new RuntimeException('Ciphertext could not be authenticated.');
        }

        return $plaintext;
    }

    /**
     * Keyed hash for values that must be comparable but not reversible
     * (IP addresses in logs, recovery codes). The purpose separates domains.
     */
    public function hash(string $purpose, string $value): string
    {
        return hash_hmac('sha256', $purpose . "\0" . $value, $this->key);
    }
}
