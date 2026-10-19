<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Status\Receiver;
use Cockpit\Status\StatusReport;
use Cockpit\Status\StatusRepository;
use Cockpit\Status\StatusView;
use PHPUnit\Framework\TestCase;

final class StatusReportTest extends TestCase
{
    private const ORG = 'Steuten-IT-Solutions';
    private const NOW = 1792368000; // 2026-10-19 00:00:00 UTC

    /**
     * A payload as packages/core/src/Update/StatusReporter.php builds it.
     *
     * @return array<string, mixed>
     */
    private static function payload(): array
    {
        return [
            'format' => 1,
            'kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt',
            'version' => '1.4.0.3',
            'variant' => 'standalone',
            'php' => '8.3',
            'database' => 'sqlite',
            'update' => ['ok' => true, 'at' => self::NOW - 3600, 'to' => '1.4.0.3'],
            'updateCheckOk' => true,
            'gallery' => null,
            'sent' => self::NOW - 60,
        ];
    }

    public function testMapsAValidReport(): void
    {
        $row = StatusReport::fromPayload(self::payload(), self::ORG, self::NOW);

        self::assertSame([
            'kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt',
            'variant' => 'standalone',
            'version' => '1.4.0.3',
            'php' => '8.3',
            'db_driver' => 'sqlite',
            'update_ok' => 1,
            'update_at' => '2026-10-18 23:00:00',
            'update_to' => '1.4.0.3',
            'update_check_ok' => 1,
            'gallery_ok' => null,
            'gallery_at' => null,
            'sent_at' => '2026-10-18 23:59:00',
        ], $row);
    }

    public function testRejectsReportsOfOtherOrganisationsAndBadShapes(): void
    {
        $cases = [
            'other org' => ['kompanie' => 'Someone-Else/kompanie-x'],
            'org prefix only' => ['kompanie' => 'Steuten-IT-Solutions-Fake/kompanie-x'],
            'trailing newline' => ['kompanie' => "Steuten-IT-Solutions/kompanie-x\n"],
            'nested path' => ['kompanie' => 'Steuten-IT-Solutions/a/b'],
            'format' => ['format' => 2],
            'format as string' => ['format' => '1'],
            'version' => ['version' => '1.4'],
            'version type' => ['version' => 1.4],
            'variant' => ['variant' => 'docker'],
        ];
        foreach ($cases as $name => $override) {
            self::assertNull(StatusReport::fromPayload($override + self::payload(), self::ORG, self::NOW), $name);
        }
        self::assertNull(StatusReport::fromPayload('not an object', self::ORG, self::NOW));
    }

    public function testNormalisesOptionalFields(): void
    {
        $row = StatusReport::fromPayload([
            'php' => '<b>8</b>',
            'database' => 'oracle',
            'update' => ['ok' => 'yes', 'at' => 99999999999, 'to' => '1.0; DROP'],
            'updateCheckOk' => 1,
            'gallery' => ['ok' => false, 'at' => 'yesterday'],
            'sent' => 1000,
        ] + self::payload(), self::ORG, self::NOW);

        self::assertNotNull($row);
        self::assertSame('?', $row['php']);
        self::assertSame('?', $row['db_driver']);
        self::assertSame(0, $row['update_ok'], 'Only a real true counts as success.');
        self::assertNull($row['update_at'], 'Far future timestamps are dropped.');
        self::assertNull($row['update_to']);
        self::assertSame(0, $row['update_check_ok']);
        self::assertSame(0, $row['gallery_ok']);
        self::assertNull($row['gallery_at']);
        self::assertNull($row['sent_at'], 'Timestamps before 2020 are dropped.');
    }

    public function testReceiverRejectsWithoutTouchingTheDatabase(): void
    {
        $receiver = new Receiver(static function (): StatusRepository {
            self::fail('The database must not be opened.');
        }, self::ORG);

        self::assertSame(404, $receiver->handle('GET', '/', '', self::NOW)->status);
        self::assertSame(404, $receiver->handle('POST', '/other', (string)json_encode(self::payload()), self::NOW)->status);
        self::assertSame(413, $receiver->handle('POST', '/', str_repeat(' ', Receiver::MAX_BODY + 1), self::NOW)->status);
        self::assertSame(400, $receiver->handle('POST', '/', '{"format":', self::NOW)->status);
        self::assertSame(400, $receiver->handle('POST', '/', str_repeat('[', 20) . str_repeat(']', 20), self::NOW)->status);
        $foreign = (string)json_encode(['kompanie' => 'Other/x'] + self::payload());
        $response = $receiver->handle('POST', '/', $foreign, self::NOW);
        self::assertSame(400, $response->status);
        self::assertSame('application/json; charset=utf-8', $response->headers['Content-Type']);
    }

    /**
     * @param array<string, mixed> $override
     * @return array{
     *     kompanie: string, variant: string, version: string, php: string, db_driver: string,
     *     update_ok: ?bool, update_at: ?string, update_to: ?string, update_check_ok: bool,
     *     gallery_ok: ?bool, gallery_at: ?string, sent_at: ?string, received_at: string
     * }
     */
    private static function stored(array $override = []): array
    {
        return array_merge([
            'kompanie' => 'Steuten-IT-Solutions/kompanie-musterstadt',
            'variant' => 'standalone',
            'version' => '1.4.0.3',
            'php' => '8.3',
            'db_driver' => 'sqlite',
            'update_ok' => true,
            'update_at' => '2026-10-18 23:00:00',
            'update_to' => '1.4.0.3',
            'update_check_ok' => true,
            'gallery_ok' => null,
            'gallery_at' => null,
            'sent_at' => '2026-10-18 23:59:00',
            'received_at' => '2026-10-18 23:59:00',
        ], $override);
    }

    public function testListsProblems(): void
    {
        self::assertSame([], StatusView::problems(self::stored(), self::NOW));
        self::assertSame(
            ['seit über 3 Tagen keine Meldung', 'Update-Liste nicht erreichbar', 'letztes Update auf 1.5.0.0 gescheitert', 'Galerie-Abgleich mit Fehler'],
            StatusView::problems(self::stored([
                'received_at' => '2026-10-15 23:59:59',
                'update_check_ok' => false,
                'update_ok' => false,
                'update_to' => '1.5.0.0',
                'gallery_ok' => false,
            ]), self::NOW),
        );
    }

    public function testComparesWithTheLatestRelease(): void
    {
        self::assertSame('v1.4.1.0', StatusView::newerRelease('1.4.0.3', 'v1.4.1.0'));
        self::assertSame('v1.4.0.10', StatusView::newerRelease('1.4.0.9', 'v1.4.0.10'));
        self::assertNull(StatusView::newerRelease('1.4.0.3', 'v1.4.0.3'));
        self::assertNull(StatusView::newerRelease('1.4.0.3', 'v1.3.0.0'));
        self::assertNull(StatusView::newerRelease('1.4.0.3', 'nightly'));
        self::assertNull(StatusView::newerRelease('1.4.0.3', null));
    }

    public function testMatchesReportsToRepositoriesByName(): void
    {
        $reports = [self::stored(), self::stored(['kompanie' => 'Steuten-IT-Solutions/unknown'])];
        $map = StatusRepository::byRepository($reports, [['id' => 7, 'full_name' => 'steuten-it-solutions/Kompanie-Musterstadt']]);

        self::assertSame([7], array_keys($map));
        self::assertCount(1, $map[7]);
        self::assertSame('kompanie-musterstadt', StatusView::name($reports[0]['kompanie']));
    }
}
