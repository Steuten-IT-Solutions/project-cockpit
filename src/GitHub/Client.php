<?php

declare(strict_types=1);

namespace Cockpit\GitHub;

use RuntimeException;

/**
 * Minimal REST client for a GitHub App: signs the app JWT, exchanges it for
 * installation tokens and performs read-only GET requests.
 */
final class Client
{
    private const API_VERSION = '2026-03-10';
    private const USER_AGENT = 'steuten-it-project-cockpit';

    /** @var \Closure(string, string, list<string>): array{int, array<string, string>, string} */
    private readonly \Closure $transport;

    /**
     * @param (\Closure(string, string, list<string>): array{int, array<string, string>, string})|null $transport
     *        method, url, headers → status, lower-cased response headers, body; defaults to curl
     */
    public function __construct(
        private readonly string $clientId,
        private readonly string $privateKeyPem,
        private readonly string $apiBase = 'https://api.github.com',
        ?\Closure $transport = null,
    ) {
        $this->transport = $transport ?? self::curl(...);
    }

    /**
     * App JWT (RS256). GitHub accepts at most 10 minutes of validity; iat is set
     * 60 s in the past against clock drift, as GitHub recommends.
     */
    public function jwt(int $now): string
    {
        $key = openssl_pkey_get_private($this->privateKeyPem);
        if ($key === false) {
            throw new RuntimeException('GitHub App private key could not be read.');
        }

        $segments = [
            self::base64Url((string)json_encode(['alg' => 'RS256', 'typ' => 'JWT'])),
            self::base64Url((string)json_encode(['iat' => $now - 60, 'exp' => $now + 540, 'iss' => $this->clientId])),
        ];
        $signature = '';
        if (!openssl_sign(implode('.', $segments), $signature, $key, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('GitHub App JWT could not be signed.');
        }
        $segments[] = self::base64Url($signature);

        return implode('.', $segments);
    }

    /**
     * @return list<array{id: int, account: string}>
     */
    public function installations(int $now): array
    {
        $installations = [];
        foreach ($this->paginate('/app/installations?per_page=100', $this->jwt($now)) as $item) {
            if (is_array($item) && is_int($item['id'] ?? null) && is_string($item['account']['login'] ?? null)) {
                $installations[] = ['id' => $item['id'], 'account' => $item['account']['login']];
            }
        }

        return $installations;
    }

    public function installationToken(int $installationId, int $now): string
    {
        [$status, , $body] = $this->request('POST', '/app/installations/' . $installationId . '/access_tokens', $this->jwt($now));
        if ($status !== 201 || !is_array($body) || !is_string($body['token'] ?? null)) {
            throw new RuntimeException(sprintf('GitHub returned %d for an installation token%s.', $status, self::reason($body)));
        }

        return $body['token'];
    }

    /**
     * @return array{int, mixed} status and decoded JSON body
     */
    public function get(string $path, string $token): array
    {
        [$status, , $body] = $this->request('GET', $path, $token);

        return [$status, $body];
    }

    /**
     * Follows Link: rel="next" and returns all items. $key selects the list inside
     * an object response, e.g. "repositories" for /installation/repositories.
     *
     * @return list<mixed>
     */
    public function paginate(string $path, string $token, ?string $key = null, int $maxPages = 10): array
    {
        $items = [];
        $url = $path;
        for ($page = 0; $url !== null && $page < $maxPages; $page++) {
            [$status, $headers, $body] = $this->request('GET', $url, $token);
            if ($status !== 200) {
                throw new RuntimeException(sprintf('GitHub returned %d for %s%s.', $status, strtok($path, '?'), self::reason($body)));
            }
            $list = $key === null ? $body : (is_array($body) ? ($body[$key] ?? null) : null);
            if (!is_array($list)) {
                throw new RuntimeException(sprintf('Unexpected response for %s.', strtok($path, '?')));
            }
            foreach ($list as $item) {
                $items[] = $item;
            }
            $url = self::nextLink($headers['link'] ?? '');
        }

        return $items;
    }

    /**
     * GitHub's own explanation of an error response, e.g. "Integration not found" or a
     * hint about the JWT's time claims. It never contains credentials. Shortened and
     * reduced to printable characters because it ends up on the dashboard.
     */
    public static function reason(mixed $body): string
    {
        $message = is_array($body) && is_string($body['message'] ?? null) ? $body['message'] : '';
        $message = trim((string)preg_replace('/[^\P{C}]+/u', ' ', $message));

        return $message === '' ? '' : ': ' . mb_substr($message, 0, 120);
    }

    public static function nextLink(string $header): ?string
    {
        foreach (explode(',', $header) as $part) {
            if (preg_match('/<([^>]+)>\s*;\s*rel="next"/', $part, $m)) {
                return $m[1];
            }
        }

        return null;
    }

    /**
     * @return array{int, array<string, string>, mixed}
     */
    private function request(string $method, string $pathOrUrl, string $bearer): array
    {
        $url = str_starts_with($pathOrUrl, 'https://') || str_starts_with($pathOrUrl, 'http://')
            ? $pathOrUrl
            : $this->apiBase . $pathOrUrl;
        // Never send the token anywhere but the configured API origin, even if a Link header pointed elsewhere.
        if (!str_starts_with($url, $this->apiBase . '/')) {
            throw new RuntimeException('Refusing to call a URL outside the GitHub API.');
        }

        [$status, $headers, $raw] = ($this->transport)($method, $url, [
            'Accept: application/vnd.github+json',
            'Authorization: Bearer ' . $bearer,
            'User-Agent: ' . self::USER_AGENT,
            'X-GitHub-Api-Version: ' . self::API_VERSION,
        ]);

        return [$status, $headers, $raw === '' ? null : json_decode($raw, true)];
    }

    /**
     * @param list<string> $headers
     * @return array{int, array<string, string>, string}
     */
    private static function curl(string $method, string $url, array $headers): array
    {
        $responseHeaders = [];
        $ch = curl_init($url);
        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, '');
        }
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function (\CurlHandle $ch, string $line) use (&$responseHeaders): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }

                return strlen($line);
            },
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if (!is_string($body)) {
            throw new RuntimeException('GitHub request failed: ' . $error);
        }

        return [$status, $responseHeaders, $body];
    }

    private static function base64Url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
