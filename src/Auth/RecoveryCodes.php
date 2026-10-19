<?php

declare(strict_types=1);

namespace Cockpit\Auth;

/**
 * Single-use recovery codes for when the authenticator app is unavailable.
 */
final class RecoveryCodes
{
    public const COUNT = 10;

    /** Unambiguous alphabet: no 0/O, 1/I/L. */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    /**
     * @return list<string> codes formatted as XXXXX-XXXXX (about 49 bits each)
     */
    public static function generate(int $count = self::COUNT): array
    {
        $codes = [];
        $max = strlen(self::ALPHABET) - 1;
        for ($i = 0; $i < $count; $i++) {
            $chars = '';
            for ($j = 0; $j < 10; $j++) {
                $chars .= self::ALPHABET[random_int(0, $max)];
            }
            $codes[] = substr($chars, 0, 5) . '-' . substr($chars, 5);
        }

        return $codes;
    }

    /**
     * Normalises user input so that case, spaces and dashes do not matter.
     */
    public static function normalise(string $input): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $input) ?? '');
    }
}
