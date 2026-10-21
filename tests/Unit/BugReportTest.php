<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\GitHub\Client;
use Cockpit\Reports\BugReport;
use Cockpit\Reports\BugReportReceiver;
use Cockpit\Reports\BugReportSync;
use Cockpit\Security\Crypto;
use Cockpit\Status\Receiver;
use PHPUnit\Framework\TestCase;

/**
 * Bug reports of the company apps (Kompanie-App-Template#64): receiver, validation, issue rendering, GitHub sync.
 */
final class BugReportTest extends TestCase
{
    private const ORG = 'Steuten-IT-Solutions';
    private const NOW = 1792368000; // 2026-10-19 00:00:00 UTC
    private const ID = '0123456789abcdef0123456789abcdef';
    private const SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private static string $privateKey = '';

    public static function setUpBeforeClass(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($key);
        openssl_pkey_export($key, $pem);
        self::$privateKey = (string)$pem;
    }

    private static function crypto(): Crypto
    {
        return new Crypto(str_repeat('k', 32));
    }

    private static function png(): string
    {
        $im = imagecreatetruecolor(4, 3);
        ob_start();
        imagepng($im);

        return base64_encode((string)ob_get_clean());
    }

    /**
     * A report as packages/core/src/Domain/BugReportService.php builds it.
     *
     * @param array<string, mixed> $override
     * @param array<string, mixed> $report
     * @return array<string, mixed>
     */
    private static function payload(array $override = [], array $report = []): array
    {
        return $override + [
            'format' => 1,
            'installation' => self::ID,
            'kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt',
            'sent' => self::NOW - 5,
            'nonce' => bin2hex(random_bytes(8)),
            'report' => $report + [
                'id' => bin2hex(random_bytes(16)),
                'description' => "Der Knopf geht nicht\nZweite Zeile",
                'expected' => 'Dass er geht',
                'page' => '#/termine/verwalten',
                'version' => '1.4.0.3',
                'variant' => 'standalone',
                'userAgent' => 'Mozilla/5.0 (Test)',
                'role' => 'Mitglied',
                'name' => null,
                'lastError' => 'Fehler 500 (HTTP 500)',
                'created' => self::NOW - 60,
            ],
            'screenshot' => null,
        ];
    }

    /**
     * @param array<mixed> $payload
     * @return array{int, string}
     */
    private static function send(BugReportReceiver $receiver, array $payload, ?string $secret = self::SECRET, string $ip = '203.0.113.5'): array
    {
        $body = (string)json_encode($payload);
        $response = $receiver->handle($body, $secret === null ? '' : Receiver::sign($body, $secret), $ip, self::NOW);
        $data = json_decode($response->body, true);

        return [$response->status, is_array($data) ? (string)($data['code'] ?? (($data['duplicate'] ?? false) ? 'duplicate' : '')) : ''];
    }

    private static function receiver(InMemoryBugReportStore $store): BugReportReceiver
    {
        return new BugReportReceiver(static fn (): InMemoryBugReportStore => $store, self::ORG, self::crypto());
    }

    public function testFirstReportTeachesTheSecretAndLaterOnesMustBeSignedWithIt(): void
    {
        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);

        self::assertSame([409, 'unknown_installation'], self::send($receiver, self::payload()));
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(['key' => self::SECRET]), str_repeat('b', 64)));
        self::assertSame([201, ''], self::send($receiver, self::payload(['key' => self::SECRET])));
        self::assertSame(self::SECRET, self::crypto()->decrypt($store->reportSecrets[self::ID]['secret_enc']));
        self::assertSame([201, ''], self::send($receiver, self::payload()));
        // Another key never replaces the stored secret.
        $other = str_repeat('c', 64);
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(['key' => $other]), $other));
        self::assertCount(2, $store->reports);
    }

    public function testInstallationKnownFromStatusReportsUsesThatSecret(): void
    {
        $store = new InMemoryBugReportStore();
        $store->statusSecrets[self::ID] = ['kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt', 'secret_enc' => self::crypto()->encrypt(self::SECRET)];
        $receiver = self::receiver($store);

        self::assertSame([201, ''], self::send($receiver, self::payload(['key' => self::SECRET])));
        self::assertSame([], $store->reportSecrets, 'no second copy of the secret');
        $other = str_repeat('c', 64);
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(['key' => $other]), $other));
    }

    public function testReplayDuplicatesAndUnknownCompanies(): void
    {
        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);
        $p = self::payload(['key' => self::SECRET]);
        self::assertSame([201, ''], self::send($receiver, $p));
        self::assertSame([409, 'replay'], self::send($receiver, $p), 'same nonce');
        self::assertSame([409, 'replay'], self::send($receiver, self::payload(['sent' => self::NOW - 3600])));
        // Sent again with a new nonce (the app missed the answer): accepted, but no second issue.
        self::assertSame([200, 'duplicate'], self::send($receiver, ['nonce' => bin2hex(random_bytes(8))] + $p));
        self::assertCount(1, $store->reports);

        $store = new InMemoryBugReportStore();
        $store->companies = ['Steuten-IT-Solutions/kompanie-andere'];
        self::assertSame([403, 'unknown_company'], self::send(self::receiver($store), self::payload(['key' => self::SECRET])));
    }

    public function testValidationAndSizeLimits(): void
    {
        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);
        $send = static fn (array $payload): int => self::send($receiver, $payload + ['key' => self::SECRET])[0];

        self::assertSame(400, $receiver->handle('{nope', '', '', self::NOW)->status);
        self::assertSame(413, $receiver->handle(str_repeat(' ', BugReportReceiver::MAX_BODY + 1), '', '', self::NOW)->status);
        self::assertSame(400, $send(self::payload(['kompanie' => 'Andere-Org/repo'])));
        self::assertSame(400, $send(self::payload(['format' => 2])));
        self::assertSame(400, $send(self::payload([], ['description' => ' '])));
        self::assertSame(400, $send(self::payload([], ['description' => str_repeat('a', BugReport::MAX_TEXT + 1)])));
        self::assertSame(400, $send(self::payload([], ['description' => "\xff\xfe"])));
        self::assertSame(400, $send(self::payload([], ['name' => ''])));
        self::assertSame(400, $send(self::payload([], ['variant' => 'other'])));
        self::assertSame(400, $send(self::payload(['screenshot' => ['type' => 'image/png', 'data' => base64_encode('kein Bild')]])));
        self::assertSame(400, $send(self::payload(['screenshot' => ['type' => 'image/jpeg', 'data' => self::png()]])), 'type must match');
        self::assertSame(400, $send(self::payload(['screenshot' => ['type' => 'image/gif', 'data' => self::png()]])));
        self::assertSame([], $store->reports);

        self::assertSame(201, $send(self::payload(['screenshot' => ['type' => 'image/png', 'data' => self::png()]], ['description' => str_repeat('ä', BugReport::MAX_TEXT)])));
        $stored = $store->all()[1]['report'] ?? null;
        self::assertNotNull($stored);
        self::assertSame(base64_decode(self::png(), true), $stored['screenshot']);
        self::assertSame('image/png', $stored['screenshot_type']);
    }

    public function testRateLimitPerInstallationAndPerIp(): void
    {
        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);
        for ($i = 0; $i < BugReportReceiver::PER_INSTALLATION_HOUR; $i++) {
            self::assertSame(201, self::send($receiver, self::payload(['key' => self::SECRET]), ip: '198.51.100.' . $i)[0]);
        }
        self::assertSame([429, 'rate_limited'], self::send($receiver, self::payload(), ip: '198.51.100.200'));

        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);
        for ($i = 0; $i < BugReportReceiver::PER_IP_HOUR; $i++) {
            self::send($receiver, self::payload(['installation' => sprintf('%032x', $i)]), ip: '198.51.100.1');
        }
        self::assertSame([429, 'rate_limited'], self::send($receiver, self::payload(['installation' => sprintf('%032x', 999)]), ip: '198.51.100.1'));
        // The IP is stored only as a keyed hash.
        self::assertSame([], array_filter(array_keys($store->counts), static fn (string $k): bool => str_contains($k, '198.51.100.1')));
    }

    public function testIssueBodyNeutralisesMentionsLinksAndMarkup(): void
    {
        self::assertSame('Der Knopf geht nicht', BugReport::title("  Der Knopf geht nicht  \nZweite Zeile"));
        self::assertSame(120, mb_strlen(BugReport::title(str_repeat('x', 300))));
        self::assertSame('kompanie:kompanie-musterstadt', BugReport::label('kompanie:', 'Steuten-IT-Solutions/Kompanie-Musterstadt'));

        $fields = [
            'description' => "@octocat schau mal #1\n```\n<img src=x onerror=alert(1)>",
            'expected' => '',
            'page' => '#/termine | ` x',
            'version' => '1.4.0.3',
            'variant' => 'wordpress',
            'userAgent' => 'UA',
            'role' => 'ohne Anmeldung',
            'name' => null,
            'lastError' => null,
            'created' => self::NOW,
        ];
        $body = BugReport::body($fields, 'Steuten-IT-Solutions/kompanie-musterstadt', self::ID, 'r1', 'https://github.com/o/r/blob/main/screenshots/2026/10/r1.png', 'Europe/Berlin');
        self::assertStringContainsString("````text\n@octocat schau mal #1\n```\n<img src=x onerror=alert(1)>\n````", $body, 'fence longer than the backticks inside');
        self::assertStringContainsString('| Seite in der App | `` #/termine \| ` x `` |', $body);
        self::assertStringContainsString('| Zeit | ` 19.10.2026 02:00 (Europe/Berlin) ` |', $body);
        self::assertStringContainsString('| Name | ` – (nicht mitgeschickt) ` |', $body);
        self::assertStringContainsString('![Bildschirmfoto](https://github.com/o/r/blob/main/screenshots/2026/10/r1.png?raw=true)', $body);
        self::assertStringNotContainsString('### Erwartet', $body);
    }

    public function testSyncCreatesLabelScreenshotAndIssueWithAScopedToken(): void
    {
        $store = new InMemoryBugReportStore();
        $receiver = self::receiver($store);
        self::send($receiver, self::payload(['key' => self::SECRET, 'screenshot' => ['type' => 'image/png', 'data' => self::png()]], ['name' => 'Max']));
        self::send($receiver, self::payload());

        $calls = [];
        $transport = static function (string $method, string $url, array $headers, string $body = '') use (&$calls): array {
            $calls[] = [$method, (string)preg_replace('#^https://api\.github\.com#', '', $url), $body];
            $path = (string)preg_replace('#^https://api\.github\.com#', '', $url);

            return match (true) {
                $method === 'GET' && $path === '/app/installations?per_page=100' => [200, [], (string)json_encode([['id' => 5, 'account' => ['login' => 'Steuten-IT-Solutions']]])],
                $path === '/app/installations/5/access_tokens' => [201, [], (string)json_encode(['token' => 'ghs_reports'])],
                $method === 'GET' && str_contains($path, '/labels/') => [404, [], '{"message":"Not Found"}'],
                $method === 'POST' && str_ends_with($path, '/labels') => [201, [], '{}'],
                $method === 'PUT' && str_contains($path, '/contents/screenshots/') => [201, [], (string)json_encode(['content' => ['html_url' => 'https://github.com/Steuten-IT-Solutions/kompanie-meldungen/blob/main/' . substr($path, (int)strpos($path, 'screenshots/'))]])],
                $method === 'POST' && str_ends_with($path, '/issues') => [201, [], (string)json_encode(['number' => count($calls), 'html_url' => 'https://github.com/x/issues/' . count($calls)])],
                default => [500, [], '{}'],
            };
        };
        $client = new Client('Iv23test', self::$privateKey, 'https://api.github.com', $transport(...));
        $sync = new BugReportSync($client, $store, 'Steuten-IT-Solutions/kompanie-meldungen', 'kompanie:', 'Europe/Berlin');

        self::assertSame(['created' => 2, 'failed' => 0, 'errors' => []], $sync->run(self::NOW));
        $scope = json_decode($calls[1][2], true);
        self::assertSame(['kompanie-meldungen'], $scope['repositories'] ?? null, 'token limited to the reports repository');
        self::assertSame('write', $scope['permissions']['issues'] ?? null);
        self::assertCount(1, array_filter($calls, static fn (array $c): bool => $c[0] === 'POST' && str_ends_with($c[1], '/labels')), 'label created once');
        $put = array_values(array_filter($calls, static fn (array $c): bool => $c[0] === 'PUT'));
        self::assertCount(1, $put);
        self::assertMatchesRegularExpression('#/repos/Steuten-IT-Solutions/kompanie-meldungen/contents/screenshots/2026/10/[0-9a-f]{32}\.png$#', $put[0][1]);
        self::assertSame(base64_decode(self::png(), true), base64_decode((string)(json_decode($put[0][2], true)['content'] ?? ''), true));
        $issue = json_decode(array_values(array_filter($calls, static fn (array $c): bool => str_ends_with($c[1], '/issues')))[0][2], true);
        self::assertIsArray($issue);
        self::assertSame('Der Knopf geht nicht', $issue['title']);
        self::assertSame(['kompanie:kompanie-musterstadt'], $issue['labels']);
        self::assertStringContainsString('| Name | ` Max ` |', $issue['body']);
        self::assertStringContainsString('?raw=true', $issue['body']);
        self::assertSame([], $store->pending(10));
        self::assertSame(['created' => 0, 'failed' => 0, 'errors' => []], $sync->run(self::NOW), 'nothing left');
    }

    public function testSyncKeepsReportsWhenGitHubFails(): void
    {
        $store = new InMemoryBugReportStore();
        self::send(self::receiver($store), self::payload(['key' => self::SECRET]));
        self::send(self::receiver($store), self::payload());
        $issues = 0;
        $transport = static function (string $method, string $url) use (&$issues): array {
            if (str_ends_with($url, '/app/installations?per_page=100')) {
                return [200, [], (string)json_encode([['id' => 5, 'account' => ['login' => 'steuten-it-solutions']]])];
            }
            if (str_ends_with($url, '/access_tokens')) {
                return [201, [], (string)json_encode(['token' => 't'])];
            }
            if (str_contains($url, '/labels/')) {
                return [200, [], '{}'];
            }
            $issues++;

            return [502, [], '{"message":"Bad Gateway"}'];
        };
        $sync = new BugReportSync(new Client('Iv23test', self::$privateKey, 'https://api.github.com', $transport(...)), $store, 'Steuten-IT-Solutions/kompanie-meldungen', 'kompanie:', 'Europe/Berlin');
        $result = $sync->run(self::NOW);
        self::assertSame(0, $result['created']);
        self::assertSame(1, $issues, 'stops after a server error');
        self::assertStringContainsString('502', $result['errors'][0]);
        self::assertCount(2, $store->pending(10));
        self::assertSame(1, $store->reports[1]['attempts']);

        // Another run holds the lock: nothing happens.
        $store->locked = true;
        self::assertSame(['created' => 0, 'failed' => 0, 'errors' => []], $sync->run(self::NOW));
    }
}
