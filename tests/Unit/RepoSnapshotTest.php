<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\GitHub\RepoSnapshot;
use Cockpit\Projects\ProjectView;
use PHPUnit\Framework\TestCase;

final class RepoSnapshotTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function repo(): array
    {
        return [
            'id' => 42,
            'name' => 'garden-planner',
            'full_name' => 'Steuten-IT-Solutions/garden-planner',
            'owner' => ['login' => 'Steuten-IT-Solutions'],
            'description' => 'Plans gardens',
            'html_url' => 'https://github.com/Steuten-IT-Solutions/garden-planner',
            'private' => true,
            'archived' => false,
            'fork' => false,
            'default_branch' => 'main',
            'pushed_at' => '2026-10-16T19:45:00Z',
            'open_issues_count' => 7,
        ];
    }

    public function testMapsRepositoryReleaseAndRun(): void
    {
        $row = RepoSnapshot::row(
            self::repo(),
            ['tag_name' => 'v1.2.0', 'html_url' => 'https://github.com/Steuten-IT-Solutions/garden-planner/releases/tag/v1.2.0', 'published_at' => '2026-10-01T08:00:00Z'],
            ['status' => 'completed', 'conclusion' => 'success', 'html_url' => 'https://github.com/Steuten-IT-Solutions/garden-planner/actions/runs/1', 'updated_at' => '2026-10-16T19:50:00Z', 'name' => 'CI'],
            2,
            '2026-10-19 12:00:00',
        );

        self::assertSame(42, $row['id']);
        self::assertSame('Steuten-IT-Solutions', $row['owner']);
        self::assertSame(1, $row['is_private']);
        self::assertSame('2026-10-16 19:45:00', $row['pushed_at']);
        self::assertSame(5, $row['open_issues'], 'open_issues_count includes pull requests');
        self::assertSame(2, $row['open_prs']);
        self::assertSame('v1.2.0', $row['release_tag']);
        self::assertSame('2026-10-01 08:00:00', $row['release_at']);
        self::assertSame('success', $row['ci_conclusion']);
        self::assertSame('CI', $row['ci_workflow']);
    }

    public function testMissingReleaseAndRunAreNull(): void
    {
        $row = RepoSnapshot::row(self::repo(), null, null, 0, '2026-10-19 12:00:00');

        self::assertNull($row['release_tag']);
        self::assertNull($row['ci_status']);
        self::assertSame(7, $row['open_issues']);
    }

    public function testRejectsLinksOutsideGitHub(): void
    {
        $repo = self::repo();
        $repo['html_url'] = 'javascript:alert(1)';
        $row = RepoSnapshot::row($repo, ['tag_name' => 'x', 'html_url' => 'https://evil.example/'], null, 0, 'now');

        self::assertSame('', $row['html_url']);
        self::assertNull($row['release_url']);
    }

    public function testCiLabels(): void
    {
        self::assertSame(['CI grün', 'ok'], ProjectView::ci('completed', 'success'));
        self::assertSame(['CI rot', 'fail'], ProjectView::ci('completed', 'failure'));
        self::assertSame(['CI läuft', 'neutral'], ProjectView::ci('in_progress', null));
        self::assertSame(['keine CI', 'neutral'], ProjectView::ci(null, null));
    }

    public function testRelativeAge(): void
    {
        $now = (int)strtotime('2026-10-19 12:00:00 UTC');

        self::assertSame('vor 5 Min.', ProjectView::age('2026-10-19 11:55:00', $now));
        self::assertSame('vor 3 Std.', ProjectView::age('2026-10-19 09:00:00', $now));
        self::assertSame('gestern', ProjectView::age('2026-10-18 10:00:00', $now));
        self::assertSame('vor 10 Tagen', ProjectView::age('2026-10-09 12:00:00', $now));
        self::assertSame('–', ProjectView::age(null, $now));
    }
}
