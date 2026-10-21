<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\GitHub\Client;
use Cockpit\Releases\GitHubWebhook;
use Cockpit\Releases\ReleaseRun;
use Cockpit\Releases\ReleaseSync;
use Cockpit\Releases\ReleaseView;
use PHPUnit\Framework\TestCase;

final class ReleaseTest extends TestCase
{
    private const REPO = 'Steuten-IT-Solutions/Kompanie-App-Template';
    private const SECRET = 'webhook-secret-with-at-least-32-chars';
    private const SHA = 'fa3a5f5491ba2023a2833b808987d0519252f21f';

    /**
     * A run as GitHub returns it (shape taken from a real run of kompanien-abgleichen.yml).
     *
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private static function workflowRun(array $overrides = []): array
    {
        return $overrides + [
            'id' => 39664542607,
            'name' => 'Kompanien abgleichen',
            'display_title' => 'Merge pull request #103 from Steuten-IT-Solutions/ccr-97ebf9e9-80dvt2',
            'event' => 'push',
            'status' => 'completed',
            'conclusion' => 'success',
            'head_branch' => 'develop',
            'head_sha' => self::SHA,
            'path' => '.github/workflows/kompanien-abgleichen.yml',
            'html_url' => 'https://github.com/Steuten-IT-Solutions/Kompanie-App-Template/actions/runs/39664542607',
            'created_at' => '2026-10-21T19:46:26Z',
            'updated_at' => '2026-10-21T19:48:16Z',
            'run_started_at' => '2026-10-21T19:46:26Z',
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{int, bool}
     */
    private static function deliver(InMemoryReleaseStore $store, string $event, array $payload, ?string $secret = null): array
    {
        $body = (string)json_encode($payload);
        $webhook = new GitHubWebhook(static fn (): InMemoryReleaseStore => $store, self::REPO, self::SECRET);
        [$response, $recorded] = $webhook->handle('POST', $event, $body, 'sha256=' . hash_hmac('sha256', $body, $secret ?? self::SECRET));

        return [$response->status, $recorded];
    }

    public function testMapsChannelsByWorkflowAndBranch(): void
    {
        $early = ReleaseRun::fromApi(self::workflowRun());
        self::assertNotNull($early);
        self::assertSame(['sync', 'early', null, '2026-10-21 19:46:26', '2026-10-21 19:48:16'], [$early['workflow'], $early['channel'], $early['publishing'], $early['started_at'], $early['updated_at']]);

        $main = ReleaseRun::fromApi(self::workflowRun(['head_branch' => 'main', 'event' => 'schedule']));
        self::assertSame('stable', $main['channel'] ?? null);

        $promote = ReleaseRun::fromApi(self::workflowRun(['head_branch' => 'main', 'path' => '.github/workflows/kern-freigeben.yml', 'display_title' => 'Release 0.1.1: develop → main (#93)']));
        self::assertNotNull($promote);
        self::assertSame(['promote', 'stable', 1], [$promote['workflow'], $promote['channel'], $promote['publishing']]);

        // Other workflows, branches and broken data are not release runs.
        self::assertNull(ReleaseRun::fromApi(self::workflowRun(['path' => '.github/workflows/ci.yml'])));
        self::assertNull(ReleaseRun::fromApi(self::workflowRun(['head_branch' => 'feature'])));
        self::assertNull(ReleaseRun::fromApi(self::workflowRun(['path' => '.github/workflows/kern-freigeben.yml'])), 'promotion runs only on main');
        self::assertNull(ReleaseRun::fromApi(self::workflowRun(['html_url' => 'https://evil.example/run'])));
        self::assertNull(ReleaseRun::fromApi(self::workflowRun(['head_sha' => 'nope'])));
    }

    public function testPublishingJobsAndCoreVersion(): void
    {
        self::assertFalse(ReleaseRun::isPublishingJob(['name' => 'finden', 'conclusion' => 'success']));
        self::assertTrue(ReleaseRun::isPublishingJob(['name' => 'veroeffentlichen (Steuten-IT-Solutions/marinekompanie-app) / build', 'conclusion' => null]));
        self::assertFalse(ReleaseRun::isPublishingJob(['name' => 'veroeffentlichen', 'conclusion' => 'skipped']));

        self::assertSame('0.1.1', ReleaseRun::coreVersion(['encoding' => 'base64', 'content' => base64_encode("0.1.1\n")]));
        self::assertNull(ReleaseRun::coreVersion(['encoding' => 'base64', 'content' => base64_encode('<script>')]));
        self::assertNull(ReleaseRun::coreVersion(null));
    }

    public function testWebhookChecksTheSignatureAndTheRepository(): void
    {
        $store = new InMemoryReleaseStore();
        $payload = ['action' => 'requested', 'workflow_run' => self::workflowRun(['status' => 'queued', 'conclusion' => null]), 'repository' => ['full_name' => self::REPO]];

        self::assertSame([401, false], self::deliver($store, 'workflow_run', $payload, 'wrong-secret-wrong-secret-wrong-secret'));
        self::assertSame(0, count($store->runs));

        $other = $payload;
        $other['repository']['full_name'] = 'Steuten-IT-Solutions/other';
        self::assertSame([200, false], self::deliver($store, 'workflow_run', $other));
        self::assertSame([200, false], self::deliver($store, 'ping', ['zen' => 'Keep it logically awesome.']));
        self::assertSame(0, count($store->runs));

        self::assertSame([200, true], self::deliver($store, 'workflow_run', $payload));
        self::assertSame('queued', $store->runs[39664542607]['status']);

        $webhook = new GitHubWebhook(static fn (): InMemoryReleaseStore => $store, self::REPO, self::SECRET);
        self::assertSame(404, $webhook->handle('GET', 'workflow_run', '', '')[0]->status);
    }

    public function testWebhookFollowsARunAndIgnoresOutdatedDeliveries(): void
    {
        $store = new InMemoryReleaseStore();
        $repo = ['full_name' => self::REPO];
        self::deliver($store, 'workflow_run', ['action' => 'in_progress', 'workflow_run' => self::workflowRun(['status' => 'in_progress', 'conclusion' => null, 'updated_at' => '2026-10-21T19:46:30Z']), 'repository' => $repo]);
        self::assertNull($store->runs[39664542607]['publishing']);

        // "finden" does not publish, the matrix job does.
        self::assertSame([200, false], self::deliver($store, 'workflow_job', ['action' => 'completed', 'workflow_job' => ['run_id' => 39664542607, 'name' => 'finden', 'conclusion' => 'success'], 'repository' => $repo]));
        self::assertNull($store->runs[39664542607]['publishing']);
        self::assertSame([200, true], self::deliver($store, 'workflow_job', ['action' => 'queued', 'workflow_job' => ['run_id' => 39664542607, 'name' => 'veroeffentlichen (Steuten-IT-Solutions/marinekompanie-app) / build', 'conclusion' => null], 'repository' => $repo]));
        self::assertSame(1, $store->runs[39664542607]['publishing']);

        $summary = ReleaseView::summary($store->releases(10));
        self::assertCount(1, $summary['early']['running']);
        self::assertSame([], $summary['stable']['running']);

        self::deliver($store, 'workflow_run', ['action' => 'completed', 'workflow_run' => self::workflowRun(), 'repository' => $repo]);
        // A late "in_progress" delivery does not reopen the run.
        self::deliver($store, 'workflow_run', ['action' => 'in_progress', 'workflow_run' => self::workflowRun(['status' => 'in_progress', 'conclusion' => null, 'updated_at' => '2026-10-21T19:46:30Z']), 'repository' => $repo]);
        self::assertSame(['completed', 'success', 1], [$store->runs[39664542607]['status'], $store->runs[39664542607]['conclusion'], $store->runs[39664542607]['publishing']]);

        $summary = ReleaseView::summary($store->releases(10));
        self::assertSame([], $summary['early']['running']);
        self::assertSame(39664542607, $summary['early']['last']['id'] ?? null);
    }

    public function testSummaryShowsLastSuccessAndALaterFailure(): void
    {
        $store = new InMemoryReleaseStore();
        $stable = ReleaseRun::fromApi(self::workflowRun(['id' => 1, 'head_branch' => 'main', 'path' => '.github/workflows/kern-freigeben.yml', 'run_started_at' => '2026-10-20T10:00:00Z', 'updated_at' => '2026-10-20T10:01:00Z']));
        $failed = ReleaseRun::fromApi(self::workflowRun(['id' => 2, 'head_branch' => 'main', 'path' => '.github/workflows/kern-freigeben.yml', 'conclusion' => 'failure', 'run_started_at' => '2026-10-21T10:00:00Z', 'updated_at' => '2026-10-21T10:01:00Z']));
        $quiet = ReleaseRun::fromApi(self::workflowRun(['id' => 3, 'run_started_at' => '2026-10-21T11:00:00Z', 'updated_at' => '2026-10-21T11:00:20Z']));
        self::assertNotNull($stable);
        self::assertNotNull($failed);
        self::assertNotNull($quiet);
        $store->upsert($stable);
        $store->upsert($failed);
        $store->upsert($quiet);
        $store->setPublishing(3, false);

        $summary = ReleaseView::summary($store->releases(10));
        self::assertSame(1, $summary['stable']['last']['id'] ?? null);
        self::assertSame(2, $summary['stable']['failed']['id'] ?? null);
        self::assertNull($summary['early']['last'], 'a sync run that published nothing is no release');
        self::assertSame('fehlgeschlagen', ReleaseView::conclusion('failure'));
    }

    public function testSyncReadsRunsJobsAndVersion(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($key);
        openssl_pkey_export($key, $pem);

        $calls = [];
        $transport = static function (string $method, string $url, array $headers, string $body = '') use (&$calls): array {
            $calls[] = $method . ' ' . substr($url, strlen('https://api.github.com'));
            $base = 'https://api.github.com/repos/Steuten-IT-Solutions/Kompanie-App-Template';
            $json = match (true) {
                str_ends_with($url, '/app/installations?per_page=100') => [['id' => 7, 'account' => ['login' => 'Steuten-IT-Solutions']]],
                str_ends_with($url, '/app/installations/7/access_tokens') => ['token' => 'ghs_test'],
                str_starts_with($url, $base . '/actions/workflows/kern-freigeben.yml/runs') => ['workflow_runs' => []],
                str_contains($url, 'kompanien-abgleichen.yml/runs?per_page=10&branch=develop') => ['workflow_runs' => [self::workflowRun()]],
                str_contains($url, 'kompanien-abgleichen.yml/runs?per_page=10&branch=main') => ['workflow_runs' => [
                    self::workflowRun(['id' => 5, 'head_branch' => 'main', 'event' => 'schedule', 'run_started_at' => '2026-10-21T19:47:00Z']),
                ]],
                $url === $base . '/actions/runs/39664542607/jobs?per_page=100' => ['jobs' => [['name' => 'finden', 'conclusion' => 'success'], ['name' => 'veroeffentlichen (Steuten-IT-Solutions/marinekompanie-app) / build', 'conclusion' => 'success']]],
                $url === $base . '/actions/runs/5/jobs?per_page=100' => ['jobs' => [['name' => 'finden', 'conclusion' => 'success'], ['name' => 'veroeffentlichen', 'conclusion' => 'skipped']]],
                $url === $base . '/contents/VERSION?ref=' . self::SHA => ['encoding' => 'base64', 'content' => base64_encode("0.1.1\n")],
                default => null,
            };

            return $json === null ? [404, [], '{"message":"Not Found"}'] : [str_ends_with($url, '/access_tokens') ? 201 : 200, [], (string)json_encode($json)];
        };

        $store = new InMemoryReleaseStore();
        $sync = new ReleaseSync(new Client('Iv23test', (string)$pem, 'https://api.github.com', $transport(...)), $store, self::REPO);
        self::assertSame(['runs' => 2], $sync->run((int)strtotime('2026-10-21T20:00:00Z')));

        self::assertSame([1, '0.1.1'], [$store->runs[39664542607]['publishing'], $store->runs[39664542607]['core_version']]);
        self::assertSame([0, null], [$store->runs[5]['publishing'], $store->runs[5]['core_version']], 'nothing published: no version read');

        // A second run reads no jobs and no version again.
        /** @var list<string> $calls filled by the transport */
        $calls = [];
        $sync->run((int)strtotime('2026-10-21T20:15:00Z'));
        self::assertSame([], array_values(array_filter($calls, static fn (string $c): bool => str_contains($c, '/jobs') || str_contains($c, '/contents/'))));
    }
}
