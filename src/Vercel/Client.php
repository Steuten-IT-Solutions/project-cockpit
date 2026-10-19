<?php

declare(strict_types=1);

namespace Cockpit\Vercel;

use RuntimeException;

/**
 * Minimal read-only Vercel REST client for one team.
 */
final class Client
{
    /** @var \Closure(string, list<string>): array{int, string} */
    private readonly \Closure $transport;

    /**
     * @param (\Closure(string, list<string>): array{int, string})|null $transport url, headers → status, body; defaults to curl
     */
    public function __construct(
        private readonly string $token,
        private readonly string $teamId,
        private readonly string $apiBase = 'https://api.vercel.com',
        ?\Closure $transport = null,
    ) {
        $this->transport = $transport ?? self::curl(...);
    }

    /**
     * @param array<string, string|int> $query
     * @return array{int, mixed} status and decoded JSON body
     */
    public function get(string $path, array $query = []): array
    {
        [$status, $raw] = $this->getRaw($path, $query, 'application/json');

        return [$status, $raw === '' ? null : json_decode($raw, true)];
    }

    /**
     * @param array<string, string|int> $query
     * @return array{int, string} status and undecoded body, e.g. JSON Lines
     */
    public function getRaw(string $path, array $query, string $accept): array
    {
        $url = $this->apiBase . $path . '?' . http_build_query($query + ['teamId' => $this->teamId], '', '&', PHP_QUERY_RFC3986);

        return ($this->transport)($url, [
            'Accept: ' . $accept,
            'Authorization: Bearer ' . $this->token,
            'User-Agent: steuten-it-project-cockpit',
        ]);
    }

    /**
     * Vercel's own explanation of an error response, shortened for the dashboard.
     */
    public static function reason(mixed $body): string
    {
        $message = is_array($body) && is_string($body['error']['message'] ?? null) ? $body['error']['message'] : '';
        $message = trim((string)preg_replace('/[^\P{C}]+/u', ' ', $message));

        return $message === '' ? '' : ': ' . mb_substr($message, 0, 120);
    }

    /**
     * @param list<string> $headers
     * @return array{int, string}
     */
    private static function curl(string $url, array $headers): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if (!is_string($body)) {
            throw new RuntimeException('Vercel request failed: ' . $error);
        }

        return [$status, $body];
    }
}
