<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Projects\ProjectView;
use Cockpit\Vercel\Client;
use Cockpit\Vercel\VercelRepository;
use Cockpit\Vercel\VercelSnapshot;
use PHPUnit\Framework\TestCase;

final class VercelTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function project(): array
    {
        return [
            'id' => 'prj_abc',
            'name' => 'toolbox-hub',
            'link' => ['type' => 'github', 'org' => 'Steuten-IT-Solutions', 'repo' => 'toolbox-hub', 'repoId' => 102, 'productionBranch' => 'main'],
            'alias' => [
                ['domain' => 'toolbox-hub-steuten.vercel.app', 'target' => 'PRODUCTION'],
                ['domain' => 'toolbox-hub.app', 'target' => 'PRODUCTION'],
                ['domain' => 'toolbox-hub-git-develop-steuten.vercel.app', 'target' => 'PREVIEW'],
            ],
        ];
    }

    public function testMapsProjectAndDeployment(): void
    {
        $row = VercelSnapshot::row(self::project(), [
            'uid' => 'dpl_1',
            'state' => 'READY',
            'created' => 1791834710546,
            'inspectorUrl' => 'https://vercel.com/steuten/toolbox-hub/3T7k',
            'meta' => ['githubCommitMessage' => "Release: fixes (#327)\n\n- details"],
        ], '2026-10-19 12:00:00');

        self::assertSame('prj_abc', $row['id']);
        self::assertSame(102, $row['repo_id']);
        self::assertSame('Steuten-IT-Solutions/toolbox-hub', $row['repo_full_name']);
        self::assertSame('toolbox-hub.app', $row['production_domain'], 'custom domain preferred over vercel.app');
        self::assertSame('READY', $row['deploy_state']);
        self::assertSame(gmdate('Y-m-d H:i:s', 1791834710), $row['deploy_created_at']);
        self::assertSame('Release: fixes (#327)', $row['deploy_commit']);
    }

    public function testFallsBackToReadyStateAndRejectsForeignLinks(): void
    {
        $project = self::project();
        unset($project['link']);
        $row = VercelSnapshot::row($project, ['readyState' => 'ERROR', 'inspectorUrl' => 'https://evil.example/x', 'errorMessage' => 'Build failed'], 'now');

        self::assertNull($row['repo_id']);
        self::assertSame('ERROR', $row['deploy_state']);
        self::assertNull($row['deploy_inspector_url']);
        self::assertSame('Build failed', $row['deploy_error']);
    }

    public function testWithoutDeployment(): void
    {
        $row = VercelSnapshot::row(['id' => 'prj_x', 'name' => 'x', 'alias' => [['domain' => 'bad domain!', 'target' => 'PRODUCTION']]], null, 'now');

        self::assertNull($row['deploy_state']);
        self::assertNull($row['production_domain']);
    }

    public function testMatchesByRepositoryIdThenByName(): void
    {
        $base = ['repo_full_name' => null, 'production_domain' => null, 'deploy_state' => null, 'deploy_created_at' => null,
            'deploy_inspector_url' => null, 'deploy_commit' => null, 'deploy_error' => null, 'synced_at' => 'now'];
        $vercel = [
            ['id' => 'a', 'name' => 'a', 'repo_id' => 102] + $base,
            ['id' => 'b', 'name' => 'b', 'repo_id' => null, 'repo_full_name' => 'steuten-it-solutions/GARDEN-planner'] + $base,
            ['id' => 'c', 'name' => 'c', 'repo_id' => null] + $base,
            ['id' => 'd', 'name' => 'd', 'repo_id' => 999, 'repo_full_name' => 'ChrisSteuten/PartyPlaylist'] + $base,
        ];
        $map = VercelRepository::byRepository($vercel, [
            ['id' => 101, 'full_name' => 'Steuten-IT-Solutions/garden-planner'],
            ['id' => 102, 'full_name' => 'Steuten-IT-Solutions/toolbox-hub'],
        ]);

        self::assertSame(['a'], array_column($map[102], 'id'));
        self::assertSame(['b'], array_column($map[101], 'id'));
        self::assertCount(2, $map);
    }

    public function testClientSendsTeamIdAndToken(): void
    {
        $seenUrl = '';
        $seenHeaders = [];
        $transport = static function (string $url, array $headers) use (&$seenUrl, &$seenHeaders): array {
            $seenUrl = $url;
            $seenHeaders = $headers;

            return [403, (string)json_encode(['error' => ['code' => 'forbidden', 'message' => "Not authorized\n"]])];
        };
        $client = new Client('tok', 'team_abc', 'https://api.vercel.com', $transport(...));

        [$status, $body] = $client->get('/v10/projects', ['limit' => 100]);

        self::assertSame(403, $status);
        self::assertSame('https://api.vercel.com/v10/projects?limit=100&teamId=team_abc', $seenUrl);
        self::assertContains('Authorization: Bearer tok', $seenHeaders);
        self::assertSame(': Not authorized', Client::reason($body));
    }

    public function testStateLabels(): void
    {
        self::assertSame(['Vercel live', 'ok'], ProjectView::vercel('READY'));
        self::assertSame(['Vercel Fehler', 'fail'], ProjectView::vercel('ERROR'));
        self::assertSame(['Vercel baut', 'neutral'], ProjectView::vercel('BUILDING'));
        self::assertSame(['Vercel: kein Deployment', 'neutral'], ProjectView::vercel(null));
    }
}
