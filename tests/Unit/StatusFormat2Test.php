<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Notify\WebPush;
use Cockpit\Security\Crypto;
use Cockpit\Status\AlertRules;
use Cockpit\Status\InstallationRepository;
use Cockpit\Status\InstallationStore;
use Cockpit\Status\Notifier;
use Cockpit\Status\Receiver;
use Cockpit\Status\StatusReport;
use Cockpit\Status\StatusRepository;
use Cockpit\Status\StatusView;
use Cockpit\View;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Status reports format 2 (project-cockpit#12, Kompanie-App-Template#20).
 *
 * @phpstan-import-type Installation from \Cockpit\Status\InstallationRepository
 */
final class StatusFormat2Test extends TestCase
{
    private const ORG = 'Steuten-IT-Solutions';
    private const NOW = 1792368000; // 2026-10-19 00:00:00 UTC
    private const ID = '0123456789abcdef0123456789abcdef';
    private const SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    /**
     * A heartbeat as packages/core/src/Update/StatusReporter.php builds it.
     *
     * @param array<string, mixed> $override
     * @return array<string, mixed>
     */
    private static function payload(array $override = []): array
    {
        return $override + [
            'format' => 2,
            'installation' => self::ID,
            'kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt',
            'version' => '1.4.0.3',
            'variant' => 'standalone',
            'php' => '8.3',
            'database' => 'sqlite',
            'kind' => 'heartbeat',
            'checks' => ['updates' => 'ok', 'gallery' => 'error', 'calendar' => 'off'],
            'errors' => ['GALLERY_SYNC' => 2],
            'cron' => ['kind' => 'real', 'last' => self::NOW - 300],
            'features' => ['events', 'gallery'],
            'update' => ['ok' => true, 'at' => self::NOW - 3600, 'to' => '1.4.0.3'],
            'updateCheckOk' => true,
            'gallery' => ['ok' => false, 'at' => self::NOW - 600],
            'sent' => self::NOW - 5,
            'nonce' => bin2hex(random_bytes(8)),
        ];
    }

    private static function store(): InMemoryInstallationStore
    {
        return new InMemoryInstallationStore();
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{int, string}
     */
    private static function send(Receiver $receiver, array $payload, ?string $secret = self::SECRET): array
    {
        $body = (string)json_encode($payload);
        $response = $receiver->handle('POST', '/', $body, self::NOW, $secret === null ? '' : Receiver::sign($body, $secret));
        $code = json_decode($response->body, true);

        return [$response->status, is_array($code) ? (string)($code['code'] ?? '') : ''];
    }

    private static function receiver(InstallationStore $store): Receiver
    {
        return new Receiver(
            static fn (): StatusRepository => throw new \LogicException('format 1 repository must not be used'),
            self::ORG,
            static fn (): InstallationStore => $store,
            new Crypto(str_repeat('k', 32)),
        );
    }

    public function testValidatesFormat2AgainstAWhitelist(): void
    {
        $row = StatusReport::fromFormat2(self::payload(), self::ORG, self::NOW);
        self::assertNotNull($row);
        self::assertSame(self::ID, $row['installation']);
        self::assertSame(['updates' => 'ok', 'gallery' => 'error', 'calendar' => 'off'], $row['checks']);
        self::assertSame(['GALLERY_SYNC' => 2], $row['errors']);
        self::assertSame('real', $row['cron_kind']);
        self::assertNull($row['event']);
        self::assertSame(1, $row['update_check_ok']);
        self::assertSame(0, $row['maintenance']);
        self::assertSame(1, StatusReport::fromFormat2(self::payload(['maintenance' => true]), self::ORG, self::NOW)['maintenance'] ?? null);
        self::assertSame(0, StatusReport::fromFormat2(self::payload(['maintenance' => 'ja']), self::ORG, self::NOW)['maintenance'] ?? null, 'only true counts');
        $many = array_map(static fn (int $n): string => str_repeat('a', $n), range(1, 14));
        self::assertNotNull(StatusReport::fromFormat2(self::payload(['features' => $many]), self::ORG, self::NOW), 'more than ten areas');

        $bad = [
            'text in a check' => ['checks' => ['gallery' => 'Ordner von max@example.org fehlt']],
            'bad check key' => ['checks' => ['Gallery Key' => 'ok']],
            'error text instead of code' => ['errors' => ['Kalender kaputt' => 1]],
            'count not an int' => ['errors' => ['DB_ERROR' => '3']],
            'checks as list' => ['checks' => ['ok', 'error']],
            'unknown cron kind' => ['cron' => ['kind' => 'systemd']],
            'event without code' => ['kind' => 'event'],
            'bad event code' => ['kind' => 'event', 'event' => 'kaputt!'],
            'short installation id' => ['installation' => 'abc'],
            'bad nonce' => ['nonce' => 'x'],
            'bad key' => ['key' => 'not-hex'],
            'other organisation' => ['kompanie' => 'Fremde/kompanie'],
            'too many errors' => ['errors' => array_fill_keys(array_map(static fn (int $n): string => 'E' . $n, range(1, 31)), 1)],
            'feature with text' => ['features' => ['events', 'max@example.org']],
            'too many features' => ['features' => array_map(static fn (int $n): string => str_repeat('a', $n % 19 + 1) . 'x', range(1, 31))],
        ];
        foreach ($bad as $name => $override) {
            self::assertNull(StatusReport::fromFormat2(self::payload($override), self::ORG, self::NOW), $name);
        }
        // An empty JSON object decodes to [] and is fine.
        self::assertNotNull(StatusReport::fromFormat2(self::payload(['errors' => []]), self::ORG, self::NOW));
    }

    public function testValidatesCausesOfErrorCodes(): void
    {
        $details = ['CALENDAR_FETCH' => ['ics_http_404' => 2, 'ics_timeout' => 1], 'UPDATE_FAILED' => ['download_http_503' => 1]];
        $row = StatusReport::fromFormat2(self::payload(['details' => $details]), self::ORG, self::NOW);
        self::assertNotNull($row);
        self::assertSame($details, $row['details']);
        self::assertNull($row['detail']);
        $event = StatusReport::fromFormat2(self::payload(['kind' => 'event', 'event' => 'UPDATE_FAILED', 'detail' => 'download_http_503']), self::ORG, self::NOW);
        self::assertSame('download_http_503', $event['detail'] ?? null);
        $unknown = StatusReport::fromFormat2(self::payload(['kind' => 'event', 'event' => 'UPDATE_FAILED']), self::ORG, self::NOW);
        self::assertNotNull($unknown);
        self::assertNull($unknown['detail'], 'an event without a known cause');

        // Older app versions send no causes: still accepted, as none.
        self::assertSame([], StatusReport::fromFormat2(self::payload(), self::ORG, self::NOW)['details'] ?? null, 'missing');
        self::assertSame([], StatusReport::fromFormat2(self::payload(['details' => []]), self::ORG, self::NOW)['details'] ?? null, 'empty object');
        self::assertSame([], StatusReport::fromFormat2(self::payload(['details' => null]), self::ORG, self::NOW)['details'] ?? null, 'null');
        // 24 hours may hold more than the 10 causes per code and hour the app sends.
        $many = array_fill_keys(array_map(static fn (int $n): string => 'cause_' . $n, range(1, 60)), 1);
        self::assertNotNull(StatusReport::fromFormat2(self::payload(['details' => ['SERVER_ERROR' => $many]]), self::ORG, self::NOW));

        $bad = [
            'details as list' => ['details' => ['ics_http_404']],
            'causes as list' => ['details' => ['CALENDAR_FETCH' => ['ics_http_404']]],
            'causes not an object' => ['details' => ['CALENDAR_FETCH' => 'ics_http_404']],
            'bad code' => ['details' => ['Kalender' => ['ics_http_404' => 1]]],
            'error text as cause' => ['details' => ['CALENDAR_FETCH' => ['Kalender von max@example.org nicht erreichbar' => 1]]],
            'cause with capitals' => ['details' => ['CALENDAR_FETCH' => ['ICS_HTTP_404' => 1]]],
            'cause starting with a digit' => ['details' => ['CALENDAR_FETCH' => ['404' => 1]]],
            'cause too long' => ['details' => ['CALENDAR_FETCH' => ['a' . str_repeat('b', 64) => 1]]],
            'count not an int' => ['details' => ['CALENDAR_FETCH' => ['ics_timeout' => '1']]],
            'count zero' => ['details' => ['CALENDAR_FETCH' => ['ics_timeout' => 0]]],
            'count too high' => ['details' => ['CALENDAR_FETCH' => ['ics_timeout' => 1000001]]],
            'too many codes' => ['details' => array_fill_keys(array_map(static fn (int $n): string => 'E' . $n, range(1, 31)), ['other' => 1])],
            'too many causes' => ['details' => ['SERVER_ERROR' => $many + ['cause_61' => 1]]],
            'detail in a heartbeat' => ['detail' => 'download_http_503'],
            'bad event detail' => ['kind' => 'event', 'event' => 'UPDATE_FAILED', 'detail' => 'Download: HTTP 503'],
            'event detail not a string' => ['kind' => 'event', 'event' => 'UPDATE_FAILED', 'detail' => 503],
        ];
        foreach ($bad as $name => $override) {
            self::assertNull(StatusReport::fromFormat2(self::payload($override), self::ORG, self::NOW), $name);
        }

        // The receiver refuses invalid causes like invalid errors and passes valid ones on.
        $store = self::store();
        $receiver = self::receiver($store);
        self::assertSame([400, 'invalid'], self::send($receiver, self::payload(['key' => self::SECRET, 'details' => ['CALENDAR_FETCH' => ['Fehlertext' => 1]]])));
        self::assertSame([201, ''], self::send($receiver, self::payload(['key' => self::SECRET, 'details' => $details])));
        self::assertSame([400, 'invalid'], self::send($receiver, self::payload(['detail' => 'download_http_503'])));
        self::assertSame([201, ''], self::send($receiver, self::payload(['kind' => 'event', 'event' => 'UPDATE_FAILED', 'detail' => 'download_http_503', 'details' => $details])));
        self::assertSame([201, ''], self::send($receiver, self::payload()), 'a report of an older app version');
        self::assertSame([$details, $details, []], array_column($store->records, 'details'));
        self::assertSame([null, 'download_http_503', null], array_column($store->records, 'detail'));

        // Many causes no longer fit the 4 KiB of the time before details, but fit MAX_BODY.
        $codes = ['UPDATE_FAILED', 'UPDATE_CHECK', 'CALENDAR_FETCH', 'GALLERY_SYNC', 'TASK_FAILED', 'SERVER_ERROR', 'DB_ERROR', 'PHP_FATAL'];
        $full = array_fill_keys($codes, array_fill_keys(array_map(static fn (int $n): string => 'typeerror_get_events_id_' . $n, range(1, 20)), 3));
        $payload = self::payload(['details' => $full]);
        self::assertGreaterThan(4096, strlen((string)json_encode($payload)));
        self::assertLessThan(Receiver::MAX_BODY, strlen((string)json_encode($payload)));
        self::assertSame([201, ''], self::send($receiver, $payload));
    }

    /**
     * InstallationRepository on SQLite with the columns of migrations 0006, 0007 and 0009 (register() uses
     * MariaDB's INSERT IGNORE, so the installation row is inserted directly).
     */
    private static function repository(): InstallationRepository
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('CREATE TABLE installations (id TEXT PRIMARY KEY, kompanie TEXT NOT NULL, variant TEXT NOT NULL, secret_enc TEXT NOT NULL,
            version TEXT NOT NULL, php TEXT NOT NULL, db_driver TEXT NOT NULL, cron_kind TEXT NOT NULL, cron_last TEXT NULL, checks TEXT NOT NULL,
            errors TEXT NOT NULL, features TEXT NOT NULL, update_ok INTEGER NULL, update_at TEXT NULL, update_to TEXT NULL,
            update_check_ok INTEGER NOT NULL, gallery_ok INTEGER NULL, gallery_at TEXT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
            last_heartbeat TEXT NULL, maintenance INTEGER NOT NULL DEFAULT 0, details TEXT NULL)');
        $pdo->exec('CREATE TABLE status_heartbeats (id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id TEXT NOT NULL, received_at TEXT NOT NULL,
            version TEXT NOT NULL, checks TEXT NOT NULL, errors TEXT NOT NULL, cron_kind TEXT NOT NULL, details TEXT NULL)');
        $pdo->exec('CREATE TABLE status_events (id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id TEXT NOT NULL, code TEXT NOT NULL,
            version TEXT NOT NULL, received_at TEXT NOT NULL, detail TEXT NULL)');
        // A row from before migration 0009: no causes (NULL).
        $pdo->prepare("INSERT INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, features,
            update_check_ok, first_seen, last_seen) VALUES (?, 'Steuten-IT-Solutions/kompanie-musterstadt', 'standalone', 'x', '1.4.0.2', '8.3',
            'sqlite', 'real', '{}', '{}', '', 1, '2026-10-18 00:00:00', '2026-10-18 00:00:00')")->execute([self::ID]);
        $pdo->exec("INSERT INTO status_heartbeats (installation_id, received_at, version, checks, errors, cron_kind)
            VALUES ('" . self::ID . "', '2026-10-18 00:00:00', '1.4.0.2', '{}', '{}', 'real')");
        $pdo->exec("INSERT INTO status_events (installation_id, code, version, received_at) VALUES ('" . self::ID . "', 'DB_ERROR', '1.4.0.2', '2026-10-18 00:30:00')");

        return new InstallationRepository($pdo);
    }

    public function testStoresCausesAtTheInstallationAndInTheHistory(): void
    {
        $repository = self::repository();
        $old = $repository->get(self::ID);
        self::assertSame([], $old['details'] ?? null, 'rows from before migration 0009');

        $details = ['CALENDAR_FETCH' => ['ics_http_404' => 2, 'ics_timeout' => 1]];
        $heartbeat = StatusReport::fromFormat2(self::payload(['details' => $details]), self::ORG, self::NOW);
        $event = StatusReport::fromFormat2(self::payload(['kind' => 'event', 'event' => 'UPDATE_FAILED', 'detail' => 'download_http_503',
            'details' => $details + ['UPDATE_FAILED' => ['download_http_503' => 1]]]), self::ORG, self::NOW);
        self::assertNotNull($heartbeat);
        self::assertNotNull($event);
        $repository->record($heartbeat, '2026-10-18 23:00:00');
        self::assertSame($details, $repository->get(self::ID)['details'] ?? null);
        $repository->record($event, '2026-10-18 23:30:00');
        self::assertSame($details + ['UPDATE_FAILED' => ['download_http_503' => 1]], $repository->get(self::ID)['details'] ?? null, 'events update the installation too');

        $history = $repository->history(self::ID, '2026-10-01 00:00:00', 10);
        self::assertSame(['event', 'heartbeat', 'event', 'heartbeat'], array_column($history, 'type'));
        self::assertSame(['download_http_503', null, null, null], array_column($history, 'detail'));
        self::assertSame([[], $details, [], []], array_column($history, 'details'), 'older heartbeats without causes');

        $events = $repository->eventsSince('2026-10-18 00:00:00');
        self::assertSame([null, 'download_http_503'], array_column($events, 'detail'));
        // The alert of an event names the cause of the latest one.
        $installation = $repository->get(self::ID);
        self::assertNotNull($installation);
        $installation['first_seen'] = gmdate('Y-m-d H:i:s', self::NOW - 600);
        $events = array_map(static fn (array $ev): array => ['received_at' => gmdate('Y-m-d H:i:s', self::NOW - 60)] + $ev, $events);
        $wanted = AlertRules::wanted([$installation], $events, self::NOW);
        self::assertSame('Update gescheitert (download_http_503)', $wanted[self::ID . '|event:UPDATE_FAILED']['detail'] ?? null);
        self::assertSame('Datenbankfehler', $wanted[self::ID . '|event:DB_ERROR']['detail'] ?? null, 'without a cause as before');
    }

    public function testShowsCausesOnTheInstallationPage(): void
    {
        self::assertSame('ics_http_404: 2, ics_timeout: 1', StatusView::causes(['ics_timeout' => 1, 'ics_http_404' => 2]));
        self::assertSame('a_b: 1, c_d: 1', StatusView::causes(['c_d' => 1, 'a_b' => 1]), 'ties by name');
        self::assertSame('', StatusView::causes([]));

        $installation = self::installation(self::ID, 'kompanie-a');
        $installation['errors'] = ['CALENDAR_FETCH' => 3, 'DB_ERROR' => 1];
        $installation['details'] = ['CALENDAR_FETCH' => ['ics_timeout' => 1, 'ics_http_404' => 2]];
        $at = gmdate('Y-m-d H:i:s', self::NOW - 60);
        $html = (new View(dirname(__DIR__, 2) . '/templates'))->render('installation', [
            'title' => 'kompanie-a', 'csrf' => 'x', 'flash' => null, 'loggedIn' => true, 'timezone' => 'Europe/Berlin', 'alerts' => [],
            'installation' => $installation,
            'history' => [
                ['type' => 'event', 'received_at' => $at, 'version' => '1.4.0.3', 'code' => 'UPDATE_FAILED', 'detail' => 'download_http_503',
                    'checks' => [], 'errors' => [], 'details' => []],
                ['type' => 'event', 'received_at' => $at, 'version' => '1.4.0.3', 'code' => 'DB_ERROR', 'detail' => null,
                    'checks' => [], 'errors' => [], 'details' => []],
            ],
        ]);
        self::assertMatchesRegularExpression('~Kalender nicht abrufbar: 3\s*<small class="muted">\(ics_http_404: 2, ics_timeout: 1\)</small>~', $html);
        self::assertMatchesRegularExpression('~Datenbankfehler: 1\s*<br>~', $html, 'a code without causes');
        self::assertStringContainsString('Ursache: <code>download_http_503</code>', $html);
        self::assertSame(1, substr_count($html, 'Ursache:'), 'an event without a cause shows none');
    }

    public function testReceiverTrustsOnFirstUseAndChecksSignatures(): void
    {
        $store = self::store();
        $receiver = self::receiver($store);

        // Unknown installation without key: the app sends the key next time.
        self::assertSame([409, 'unknown_installation'], self::send($receiver, self::payload()));
        // With key, but the signature does not match the key.
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(['key' => self::SECRET]), str_repeat('b', 64)));
        self::assertCount(0, $store->installations);
        // First valid report registers the installation with the encrypted secret.
        self::assertSame([201, ''], self::send($receiver, self::payload(['key' => self::SECRET])));
        self::assertArrayHasKey(self::ID, $store->installations);
        self::assertNotSame(self::SECRET, $store->installations[self::ID]['secret_enc'], 'stored encrypted');
        self::assertSame(self::SECRET, (new Crypto(str_repeat('k', 32)))->decrypt($store->installations[self::ID]['secret_enc']));

        // Later reports: signature with the stored secret; a different key never replaces it.
        self::assertSame([201, ''], self::send($receiver, self::payload(['kind' => 'event', 'event' => 'UPDATE_FAILED'])));
        $other = str_repeat('c', 64);
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(['key' => $other]), $other));
        self::assertSame([401, 'bad_signature'], self::send($receiver, self::payload(), null));
        // The signature proves the installation: a renamed company repository is taken over.
        self::assertSame([201, ''], self::send($receiver, self::payload(['kompanie' => 'Steuten-IT-Solutions/kompanie-neu'])));

        self::assertCount(3, $store->records);
        self::assertSame('UPDATE_FAILED', $store->records[1]['event']);
        self::assertSame('Steuten-IT-Solutions/kompanie-neu', $store->records[2]['kompanie']);
    }

    public function testOnlyCompaniesWithARepositoryCanRegister(): void
    {
        $store = self::store();
        $store->companies = ['Steuten-IT-Solutions/kompanie-musterstadt'];
        $receiver = self::receiver($store);
        $other = bin2hex(random_bytes(16));
        self::assertSame([403, 'unknown_company'], self::send($receiver, self::payload(['installation' => $other, 'kompanie' => 'Steuten-IT-Solutions/erfunden', 'key' => self::SECRET])));
        self::assertCount(0, $store->installations);
        self::assertSame([201, ''], self::send($receiver, self::payload(['kompanie' => 'Steuten-IT-Solutions/Kompanie-Musterstadt', 'key' => self::SECRET])), 'case-insensitive');
    }

    public function testParallelFirstReportUsesTheStoredSecret(): void
    {
        $store = self::store();
        $receiver = self::receiver($store);
        // Another request registered the installation between find() and register(): simulated by a
        // store whose find() reports nothing on the first call.
        $racing = new class ($store) extends InMemoryInstallationStore {
            private bool $first = true;

            public function __construct(private readonly InMemoryInstallationStore $inner)
            {
            }

            public function find(string $id): ?array
            {
                if ($this->first) {
                    $this->first = false;

                    return null;
                }

                return $this->inner->find($id);
            }

            public function register(array $report, string $secretEnc, string $now): bool
            {
                return $this->inner->register($report, $secretEnc, $now);
            }
        };
        self::assertSame(201, self::send($receiver, self::payload(['key' => self::SECRET]))[0]);
        $other = str_repeat('d', 64);
        self::assertSame([401, 'bad_signature'], self::send(self::receiver($racing), self::payload(['key' => $other]), $other),
            'the stored secret decides, the parallel key is not taken');
    }

    public function testReceiverBlocksReplays(): void
    {
        $store = self::store();
        $receiver = self::receiver($store);
        $payload = self::payload(['key' => self::SECRET]);
        self::assertSame(201, self::send($receiver, $payload)[0]);
        self::assertSame([409, 'replay'], self::send($receiver, $payload), 'same nonce');
        self::assertSame([409, 'replay'], self::send($receiver, self::payload(['sent' => self::NOW - Receiver::REPLAY_WINDOW - 1])), 'too old');
        self::assertSame([409, 'replay'], self::send($receiver, self::payload(['sent' => self::NOW + Receiver::REPLAY_WINDOW + 1])), 'from the future');
        self::assertCount(1, $store->records);
    }

    public function testReceiverStillAcceptsFormat1WithoutInstallationStore(): void
    {
        // Format 2 without configured store and crypto is refused, format 1 goes to its repository.
        $receiver = new Receiver(static fn (): StatusRepository => throw new \LogicException('not reached'), self::ORG);
        self::assertSame(400, $receiver->handle('POST', '/', (string)json_encode(self::payload()), self::NOW)->status);
    }

    /**
     * @param array<string, string> $checks
     * @return Installation
     */
    private static function installation(string $id, string $name, string $cronKind = 'real', int $quietFor = 600, array $checks = ['updates' => 'ok']): array
    {
        return [
            'id' => $id, 'kompanie' => 'Steuten-IT-Solutions/' . $name, 'variant' => 'standalone', 'version' => '1.4.0.3',
            'php' => '8.3', 'db_driver' => 'sqlite', 'cron_kind' => $cronKind, 'cron_last' => null,
            'checks' => $checks, 'errors' => [], 'details' => [], 'features' => [], 'update_ok' => true, 'update_at' => null,
            'update_to' => null, 'update_check_ok' => true, 'gallery_ok' => null, 'gallery_at' => null, 'maintenance' => false,
            'first_seen' => gmdate('Y-m-d H:i:s', self::NOW - 86400), 'last_seen' => gmdate('Y-m-d H:i:s', self::NOW - $quietFor),
            'last_heartbeat' => gmdate('Y-m-d H:i:s', self::NOW - $quietFor),
        ];
    }

    public function testAlertRules(): void
    {
        $a = self::installation(self::ID, 'kompanie-a');
        $b = self::installation(str_repeat('b', 32), 'kompanie-b', 'real', 3 * 3600);
        $c = self::installation(str_repeat('c', 32), 'kompanie-c', 'pseudo', 3 * 3600);
        $d = self::installation(str_repeat('d', 32), 'kompanie-d', 'real', 600, ['gallery' => 'error', 'backup' => 'warn']);
        $e = self::installation(str_repeat('e', 32), 'kompanie-e');
        $e['first_seen'] = gmdate('Y-m-d H:i:s', self::NOW - 3600); // registered an hour ago
        $events = [
            ['installation_id' => self::ID, 'code' => 'UPDATE_FAILED', 'version' => '1.4.0.3', 'received_at' => gmdate('Y-m-d H:i:s', self::NOW - 1800)],
            ['installation_id' => $b['id'], 'code' => 'PHP_FATAL', 'version' => '1.4.0.3', 'received_at' => gmdate('Y-m-d H:i:s', self::NOW - 2 * 86400)],
            ['installation_id' => $d['id'], 'code' => 'CHECK_ERROR', 'version' => '1.4.0.3', 'received_at' => gmdate('Y-m-d H:i:s', self::NOW - 600)],
            ['installation_id' => $e['id'], 'code' => 'DB_ERROR', 'version' => '1.4.0.3', 'received_at' => gmdate('Y-m-d H:i:s', self::NOW - 600)],
        ];
        $wanted = AlertRules::wanted([$a, $b, $c, $d, $e], $events, self::NOW);
        $keys = array_keys($wanted);
        sort($keys);
        self::assertSame([
            self::ID . '|event:UPDATE_FAILED',
            str_repeat('b', 32) . '|silent',
            str_repeat('d', 32) . '|check:gallery',
            str_repeat('e', 32) . '|event:DB_ERROR',
        ], $keys, 'silent after 2 h with real cron, not yet with pseudo-cron; old events expire; warn and CHECK_ERROR raise nothing; '
            . 'no release alert: a red light is no release error and kompanie-e is new');

        // Maintenance mode: a red light is expected (tasks paused) and raises no alert; silence still does.
        $m = self::installation(str_repeat('f', 32), 'kompanie-f', 'real', 600, ['gallery' => 'error']);
        $m['maintenance'] = true;
        self::assertSame([], AlertRules::wanted([$m], [], self::NOW));
        $m['last_heartbeat'] = gmdate('Y-m-d H:i:s', self::NOW - 3 * 3600);
        self::assertSame([str_repeat('f', 32) . '|silent'], array_keys(AlertRules::wanted([$m], [], self::NOW)));
        self::assertSame('maintenance', StatusView::light($m, true));
        self::assertSame('error', StatusView::light($d, true));

        // Two installations known for a day with severe errors on the same version: release alert.
        $e['first_seen'] = gmdate('Y-m-d H:i:s', self::NOW - 2 * 86400);
        $wanted = AlertRules::wanted([$a, $b, $c, $d, $e], $events, self::NOW);
        self::assertArrayHasKey('*|release:1.4.0.3', $wanted);
        self::assertStringContainsString('kompanie-a', $wanted['*|release:1.4.0.3']['detail']);
        self::assertStringContainsString('kompanie-e', $wanted['*|release:1.4.0.3']['detail']);
        self::assertStringNotContainsString('kompanie-d', $wanted['*|release:1.4.0.3']['detail']);

        // Lifecycle: open new, keep existing, resolve gone.
        $open = [
            ['id' => 1, 'installation_id' => self::ID, 'kompanie' => $a['kompanie'], 'alert_key' => 'event:UPDATE_FAILED', 'detail' => 'x'],
            ['id' => 2, 'installation_id' => self::ID, 'kompanie' => $a['kompanie'], 'alert_key' => 'silent', 'detail' => 'x'],
        ];
        $diff = AlertRules::diff($wanted, $open);
        self::assertSame([['id' => 1, 'detail' => 'Update gescheitert']], $diff['touch']);
        self::assertSame([2], $diff['resolve']);
        self::assertCount(4, $diff['open']);
    }

    public function testNotificationMessage(): void
    {
        $alert = static fn (array $o): array => $o + [
            'id' => 1, 'installation_id' => self::ID, 'kompanie' => 'Steuten-IT-Solutions/kompanie-a', 'variant' => 'wordpress',
            'alert_key' => 'check:gallery', 'detail' => 'Galerie: rot', 'opened_at' => '2026-10-18 10:00:00', 'last_seen_at' => '2026-10-18 10:00:00',
            'notified_at' => null, 'resolved_at' => null, 'resolved_notified_at' => null,
        ];
        [$subject, $body] = Notifier::message([
            $alert([]),
            $alert(['id' => 2, 'alert_key' => 'silent', 'detail' => 'kein Lebenszeichen', 'notified_at' => '2026-10-18 09:00:00', 'resolved_at' => '2026-10-18 11:00:00']),
        ], 'https://cockpit.example.org');
        self::assertSame('Cockpit: 1 Warnung, 1 Entwarnung', $subject);
        self::assertStringContainsString('- kompanie-a (WordPress): Galerie: rot', $body);
        self::assertStringContainsString('https://cockpit.example.org/installation?id=' . self::ID, $body);
        self::assertStringContainsString("Entwarnung (Problem behoben):\n- kompanie-a (WordPress): kein Lebenszeichen", $body);

        $sent = [];
        $notifier = new Notifier('https://cockpit.example.org', 'ops@example.org', 'Cockpit <cockpit@example.org>', null, null,
            static function (string $to, string $subject, string $body, string $headers) use (&$sent): bool {
                $sent[] = [$to, $subject, $headers];

                return true;
            });
        self::assertTrue($notifier->send([$alert([])], self::NOW));
        self::assertSame('ops@example.org', $sent[0][0]);
        self::assertStringContainsString('From: Cockpit <cockpit@example.org>', $sent[0][2]);
    }

    public function testVapidTokenIsAValidEs256Jwt(): void
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        self::assertNotFalse($key);
        openssl_pkey_export($key, $pem);
        $calls = [];
        $push = new WebPush($pem, 'mailto:ops@example.org', static function (string $endpoint, array $headers) use (&$calls): int {
            $calls[] = [$endpoint, $headers];

            return 201;
        });
        self::assertSame(201, $push->send('https://fcm.googleapis.com/fcm/send/abc', self::NOW));
        self::assertSame('0', $calls[0][1]['Content-Length']);
        self::assertMatchesRegularExpression('/^vapid t=([^,]+), k=([A-Za-z0-9_-]{87})$/', $calls[0][1]['Authorization']);
        if (preg_match('/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=/', $calls[0][1]['Authorization'], $m) !== 1) {
            self::fail('No VAPID token in the Authorization header.');
        }
        [, $h, $c, $s] = $m;
        $claims = json_decode((string)base64_decode(strtr($c, '-_', '+/')), true);
        self::assertSame('https://fcm.googleapis.com', $claims['aud']);
        self::assertSame(self::NOW + 43200, $claims['exp']);
        self::assertSame('mailto:ops@example.org', $claims['sub']);

        // Raw r||s back to DER and verify with the public key.
        $raw = (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
        self::assertSame(64, strlen($raw));
        $int = static function (string $bytes): string {
            $bytes = ltrim($bytes, "\x00");
            if ($bytes === '' || (ord($bytes[0]) & 0x80)) {
                $bytes = "\x00" . $bytes;
            }

            return "\x02" . chr(strlen($bytes)) . $bytes;
        };
        $seq = $int(substr($raw, 0, 32)) . $int(substr($raw, 32));
        $der = "\x30" . chr(strlen($seq)) . $seq;
        $public = openssl_pkey_get_details($key)['key'] ?? '';
        self::assertSame(1, openssl_verify($h . '.' . $c, $der, $public, OPENSSL_ALGO_SHA256));

        self::assertTrue(WebPush::validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
        self::assertTrue(WebPush::validEndpoint('https://web.push.apple.com/abc'));
        self::assertFalse(WebPush::validEndpoint('http://fcm.googleapis.com/fcm/send/abc'), 'https only');
        self::assertFalse(WebPush::validEndpoint('https://intranet.example.org/push'), 'only known push services');
        self::assertFalse(WebPush::validEndpoint('https://evilpush.apple.com.example.org/x'));
        self::assertFalse(WebPush::validEndpoint('https://user:pw@fcm.googleapis.com/fcm/send/abc'));
    }

    public function testLabels(): void
    {
        self::assertSame('Galerie-Abgleich mit Fehler', StatusView::codeLabel('GALLERY_SYNC'));
        self::assertSame('NEU_CODE', StatusView::codeLabel('NEU_CODE'), 'unknown codes as is');
        self::assertSame('Ampel rot: Galerie', StatusView::alertLabel('check:gallery'));
        self::assertSame('error', StatusView::light(['checks' => ['updates' => 'ok'], 'errors' => []], true));
        self::assertSame('warn', StatusView::light(['checks' => ['updates' => 'ok'], 'errors' => ['DB_ERROR' => 1]], false));
        self::assertSame('ok', StatusView::light(['checks' => ['updates' => 'ok'], 'errors' => []], false));
    }
}
