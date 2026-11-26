import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Alert, ReleaseRun } from '../../shared/types/cockpit'
import { GitHubClient, type HttpTransport, nextLink, reason } from '../../server/lib/github/client'
import { repoSnapshot } from '../../server/lib/github/sync'
import { coreVersion, isPublishingJob, releaseFromApi, type ReleaseRow } from '../../server/lib/releases/run'
import { ReleaseSync, type ReleaseStore } from '../../server/lib/releases/sync'
import { alertMessage, Notifier } from '../../server/lib/status/notifier'
import { diffAlerts, wantedAlerts } from '../../server/lib/status/rules'
import { billingPeriod } from '../../server/lib/vercel/billing'
import { VercelClient } from '../../server/lib/vercel/client'
import { vercelSnapshot } from '../../server/lib/vercel/sync'
import { utc } from '../../server/lib/time'

// Ports of the PHP cockpit's tests for the background jobs (tests/Unit/GitHubClientTest.php,
// RepoSnapshotTest.php, VercelTest.php, ReleaseTest.php, StatusFormat2Test.php), with the
// same inputs and expected values, so both implementations agree.

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const NOW = 1792368000 // 2026-10-19 00:00:00 UTC
const ID = '0123456789abcdef0123456789abcdef'

/** A fake GitHub: answers by function, records every call. */
function fake(answer: (method: string, path: string, body: string) => [number, unknown, Record<string, string>?]) {
  const calls: { method: string, path: string, headers: Record<string, string>, body: string }[] = []
  const transport: HttpTransport = async (method, url, headers, body = '') => {
    const path = url.replace(/^https:\/\/api\.github\.com/, '')
    calls.push({ method, path, headers, body })
    const [status, json, responseHeaders] = answer(method, path, body)
    return { status, headers: responseHeaders ?? {}, body: typeof json === 'string' ? json : JSON.stringify(json) }
  }
  return { calls, client: new GitHubClient('Iv23test', PEM, 'https://api.github.com', transport) }
}

describe('GitHub client', () => {
  it('signs an RS256 app JWT with a short lifetime', () => {
    const jwt = new GitHubClient('Iv23test', PEM).jwt(1_000_000)
    const [head, claims, signature] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: 'Iv23test' })
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), createPublicKey(privateKey), Buffer.from(signature, 'base64url'))).toBe(true)
    expect(() => new GitHubClient('Iv23test', 'not a key').jwt(1)).toThrow()
  })

  it('follows Link headers and sends its headers', async () => {
    const { calls, client } = fake((_m, path) => path.includes('page=2')
      ? [200, { repositories: [{ id: 2 }] }]
      : [200, { repositories: [{ id: 1 }] }, { link: '<https://api.github.com/installation/repositories?page=2>; rel="next", <https://api.github.com/installation/repositories?page=2>; rel="last"' }])
    expect(await client.paginate('/installation/repositories?per_page=100', 'tok', 'repositories')).toEqual([{ id: 1 }, { id: 2 }])
    expect(calls).toHaveLength(2)
    expect(calls[0]!.path).toBe('/installation/repositories?per_page=100')
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok')
    expect(calls[0]!.headers['X-GitHub-Api-Version']).toBe('2026-03-10')
  })

  it('never sends the token to another host', async () => {
    const { client } = fake(() => [200, [], { link: '<https://evil.example/steal>; rel="next"' }])
    await expect(client.paginate('/app/installations', 'tok')).rejects.toThrow()
  })

  it('lists installations, gets tokens and reports GitHub\'s reason', async () => {
    const { client } = fake((method, path) => {
      if (method === 'GET' && path.split('?')[0] === '/app/installations') {
        return [200, [{ id: 11, account: { login: 'Steuten-IT-Solutions' } }, { id: 12, account: { login: 'ChrisSteuten' } }]]
      }
      if (method === 'POST' && path === '/app/installations/11/access_tokens') return [201, { token: 'ghs_abc' }]
      return [404, {}]
    })
    expect(await client.installations(1000)).toEqual([{ id: 11, account: 'Steuten-IT-Solutions' }, { id: 12, account: 'ChrisSteuten' }])
    expect(await client.installationToken(11, 1000)).toBe('ghs_abc')
    await expect(client.installationToken(99, 1000)).rejects.toThrow()

    const failing = fake(() => [401, { message: 'A JSON web token could not be decoded\n' }]).client
    await expect(failing.installations(1000)).rejects.toThrow('GitHub returned 401 for /app/installations: A JSON web token could not be decoded.')
    expect(reason(null)).toBe('')
    expect(reason({ message: 42 })).toBe('')
  })

  it('parses Link headers', () => {
    expect(nextLink('')).toBeNull()
    expect(nextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull()
    expect(nextLink('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next"')).toBe('https://api.github.com/x?page=3')
  })

  it('asks for scoped tokens and sends JSON', async () => {
    const { calls, client } = fake((_m, path) => path.endsWith('/access_tokens') ? [201, { token: 'ghs_scoped' }] : [201, { number: 7 }])
    expect(await client.installationToken(11, 1000, ['kompanie-meldungen'], { issues: 'write' })).toBe('ghs_scoped')
    expect(JSON.parse(calls[0]!.body)).toEqual({ repositories: ['kompanie-meldungen'], permissions: { issues: 'write' } })
    expect(await client.send('POST', '/repos/o/r/issues', 'ghs_scoped', { title: 'Ä' })).toEqual([201, { number: 7 }])
    expect(calls[1]!.body).toBe('{"title":"Ä"}')
    expect(calls[1]!.headers['Content-Type']).toBe('application/json')
    await client.installationToken(11, 1000)
    expect(calls[2]!.body).toBe('')
  })
})

describe('repository snapshot', () => {
  const repo = () => ({
    id: 42,
    name: 'garden-planner',
    full_name: 'Steuten-IT-Solutions/garden-planner',
    owner: { login: 'Steuten-IT-Solutions' },
    description: 'Plans gardens',
    html_url: 'https://github.com/Steuten-IT-Solutions/garden-planner',
    private: true,
    archived: false,
    fork: false,
    default_branch: 'main',
    pushed_at: '2026-10-16T19:45:00Z',
    open_issues_count: 7,
  } as Record<string, unknown>)

  it('maps repository, release and run', () => {
    const row = repoSnapshot(
      repo(),
      { tag_name: 'v1.2.0', html_url: 'https://github.com/Steuten-IT-Solutions/garden-planner/releases/tag/v1.2.0', published_at: '2026-10-01T08:00:00Z' },
      { status: 'completed', conclusion: 'success', html_url: 'https://github.com/Steuten-IT-Solutions/garden-planner/actions/runs/1', updated_at: '2026-10-16T19:50:00Z', name: 'CI' },
      2,
      '2026-10-19 12:00:00',
    )
    expect(row).toMatchObject({
      id: 42, owner: 'Steuten-IT-Solutions', isPrivate: true, pushedAt: '2026-10-16 19:45:00',
      openIssues: 5, openPrs: 2, releaseTag: 'v1.2.0', releaseAt: '2026-10-01 08:00:00', ciConclusion: 'success', ciWorkflow: 'CI',
    })
  })

  it('has null release and run when there are none', () => {
    const row = repoSnapshot(repo(), null, null, 0, '2026-10-19 12:00:00')
    expect([row.releaseTag, row.ciStatus, row.openIssues]).toEqual([null, null, 7])
  })

  it('rejects links outside GitHub', () => {
    const row = repoSnapshot({ ...repo(), html_url: 'javascript:alert(1)' }, { tag_name: 'x', html_url: 'https://evil.example/' }, null, 0, 'now')
    expect(row.htmlUrl).toBe('')
    expect(row.releaseUrl).toBeNull()
  })
})

describe('Vercel snapshot', () => {
  const project = () => ({
    id: 'prj_abc',
    name: 'toolbox-hub',
    link: { type: 'github', org: 'Steuten-IT-Solutions', repo: 'toolbox-hub', repoId: 102, productionBranch: 'main' },
    alias: [
      { domain: 'toolbox-hub-steuten.vercel.app', target: 'PRODUCTION' },
      { domain: 'toolbox-hub.app', target: 'PRODUCTION' },
      { domain: 'toolbox-hub-git-develop-steuten.vercel.app', target: 'PREVIEW' },
    ],
  } as Record<string, unknown>)

  it('maps project and deployment', () => {
    const row = vercelSnapshot(project(), {
      uid: 'dpl_1', state: 'READY', created: 1791834710546, inspectorUrl: 'https://vercel.com/steuten/toolbox-hub/3T7k',
      meta: { githubCommitMessage: 'Release: fixes (#327)\n\n- details' },
    }, '2026-10-19 12:00:00')
    expect(row).toMatchObject({
      id: 'prj_abc', repoId: 102, repoFullName: 'Steuten-IT-Solutions/toolbox-hub', productionDomain: 'toolbox-hub.app',
      deployState: 'READY', deployCreatedAt: utc(0, 1791834710 * 1000), deployCommit: 'Release: fixes (#327)',
    })
  })

  it('falls back to readyState and rejects foreign links', () => {
    const { link: _link, ...rest } = project()
    const row = vercelSnapshot(rest, { readyState: 'ERROR', inspectorUrl: 'https://evil.example/x', errorMessage: 'Build failed' }, 'now')
    expect([row.repoId, row.deployState, row.deployInspectorUrl, row.deployError]).toEqual([null, 'ERROR', null, 'Build failed'])
  })

  it('works without a deployment', () => {
    const row = vercelSnapshot({ id: 'prj_x', name: 'x', alias: [{ domain: 'bad domain!', target: 'PRODUCTION' }] }, null, 'now')
    expect([row.deployState, row.productionDomain]).toEqual([null, null])
  })

  it('sends team id and token', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const client = new VercelClient('tok', 'team_abc', 'https://api.vercel.com', async (url, headers) => {
      seenUrl = url
      seenHeaders = headers
      return { status: 403, body: JSON.stringify({ error: { code: 'forbidden', message: 'Not authorized\n' } }) }
    })
    const [status] = await client.get('/v10/projects', { limit: 100 })
    expect(status).toBe(403)
    expect(seenUrl).toBe('https://api.vercel.com/v10/projects?limit=100&teamId=team_abc')
    expect(seenHeaders.Authorization).toBe('Bearer tok')
  })

  it('bills from the first of the month to tomorrow', () => {
    expect(billingPeriod(NOW)).toEqual(['2026-10-01', '2026-10-20'])
  })
})

describe('release runs', () => {
  const SHA = 'fa3a5f5491ba2023a2833b808987d0519252f21f'
  const workflowRun = (overrides: Record<string, unknown> = {}) => ({
    id: 39664542607,
    name: 'Kompanien abgleichen',
    display_title: 'Merge pull request #103 from Steuten-IT-Solutions/ccr-97ebf9e9-80dvt2',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'develop',
    head_sha: SHA,
    path: '.github/workflows/kompanien-abgleichen.yml',
    html_url: 'https://github.com/Steuten-IT-Solutions/Kompanie-App-Template/actions/runs/39664542607',
    created_at: '2026-10-21T19:46:26Z',
    updated_at: '2026-10-21T19:48:16Z',
    run_started_at: '2026-10-21T19:46:26Z',
    ...overrides,
  })

  it('maps channels by workflow and branch', () => {
    const early = releaseFromApi(workflowRun())!
    expect([early.workflow, early.channel, early.publishing, early.startedAt, early.updatedAt]).toEqual(['sync', 'early', null, '2026-10-21 19:46:26', '2026-10-21 19:48:16'])
    expect(releaseFromApi(workflowRun({ head_branch: 'main', event: 'schedule' }))?.channel).toBe('stable')
    const promote = releaseFromApi(workflowRun({ head_branch: 'main', path: '.github/workflows/kern-freigeben.yml', display_title: 'Release 0.1.1: develop → main (#93)' }))!
    expect([promote.workflow, promote.channel, promote.publishing]).toEqual(['promote', 'stable', 1])

    expect(releaseFromApi(workflowRun({ path: '.github/workflows/ci.yml' }))).toBeNull()
    expect(releaseFromApi(workflowRun({ head_branch: 'feature' }))).toBeNull()
    expect(releaseFromApi(workflowRun({ path: '.github/workflows/kern-freigeben.yml' }))).toBeNull()
    expect(releaseFromApi(workflowRun({ html_url: 'https://evil.example/run' }))).toBeNull()
    expect(releaseFromApi(workflowRun({ head_sha: 'nope' }))).toBeNull()
  })

  it('recognises publishing jobs and the core version', () => {
    expect(isPublishingJob({ name: 'finden', conclusion: 'success' })).toBe(false)
    expect(isPublishingJob({ name: 'veroeffentlichen (Steuten-IT-Solutions/marinekompanie-app) / build', conclusion: null })).toBe(true)
    expect(isPublishingJob({ name: 'veroeffentlichen', conclusion: 'skipped' })).toBe(false)
    expect(coreVersion({ encoding: 'base64', content: Buffer.from('0.1.1\n').toString('base64') })).toBe('0.1.1')
    expect(coreVersion({ encoding: 'base64', content: Buffer.from('<script>').toString('base64') })).toBeNull()
    expect(coreVersion(null)).toBeNull()
  })

  /** In memory, with the same rules as ReleaseRepository (tests/Unit/InMemoryReleaseStore.php). */
  class MemoryReleases implements ReleaseStore {
    runs = new Map<number, ReleaseRun>()
    async upsert(row: ReleaseRow) {
      const old = this.runs.get(row.id)
      if (old === undefined) {
        this.runs.set(row.id, { ...row, coreVersion: null })
        return
      }
      if (row.updatedAt >= old.updatedAt) Object.assign(old, { status: row.status, conclusion: row.conclusion })
      old.publishing ??= row.publishing
      old.title = row.title ?? old.title
      old.updatedAt = old.updatedAt > row.updatedAt ? old.updatedAt : row.updatedAt
    }

    async setPublishing(id: number, publishing: boolean) {
      const run = this.runs.get(id)
      if (run) run.publishing = publishing ? 1 : 0
    }

    async setCoreVersion(id: number, version: string) {
      const run = this.runs.get(id)
      if (run) run.coreVersion = version
    }

    async pending(since: string, limit: number) {
      return [...this.runs.values()]
        .filter(r => r.startedAt >= since && (r.publishing === null || (r.publishing === 1 && r.coreVersion === null)))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit)
    }

    async prune() {}
  }

  it('reads runs, jobs and the core version once', async () => {
    const base = '/repos/Steuten-IT-Solutions/Kompanie-App-Template'
    const { calls, client } = fake((_m, path) => {
      if (path === '/app/installations?per_page=100') return [200, [{ id: 7, account: { login: 'Steuten-IT-Solutions' } }]]
      if (path === '/app/installations/7/access_tokens') return [201, { token: 'ghs_test' }]
      if (path.startsWith(`${base}/actions/workflows/kern-freigeben.yml/runs`)) return [200, { workflow_runs: [] }]
      if (path.includes('kompanien-abgleichen.yml/runs?per_page=10&branch=develop')) return [200, { workflow_runs: [workflowRun()] }]
      if (path.includes('kompanien-abgleichen.yml/runs?per_page=10&branch=main')) {
        return [200, { workflow_runs: [workflowRun({ id: 5, head_branch: 'main', event: 'schedule', run_started_at: '2026-10-21T19:47:00Z' })] }]
      }
      if (path === `${base}/actions/runs/39664542607/jobs?per_page=100`) {
        return [200, { jobs: [{ name: 'finden', conclusion: 'success' }, { name: 'veroeffentlichen (Steuten-IT-Solutions/marinekompanie-app) / build', conclusion: 'success' }] }]
      }
      if (path === `${base}/actions/runs/5/jobs?per_page=100`) return [200, { jobs: [{ name: 'finden', conclusion: 'success' }, { name: 'veroeffentlichen', conclusion: 'skipped' }] }]
      if (path === `${base}/contents/VERSION?ref=${SHA}`) return [200, { encoding: 'base64', content: Buffer.from('0.1.1\n').toString('base64') }]
      return [404, { message: 'Not Found' }]
    })
    const store = new MemoryReleases()
    const sync = new ReleaseSync(client, store, 'Steuten-IT-Solutions/Kompanie-App-Template')
    expect(await sync.run(Date.parse('2026-10-21T20:00:00Z') / 1000)).toEqual({ runs: 2 })
    expect([store.runs.get(39664542607)?.publishing, store.runs.get(39664542607)?.coreVersion]).toEqual([1, '0.1.1'])
    expect([store.runs.get(5)?.publishing, store.runs.get(5)?.coreVersion]).toEqual([0, null])

    calls.length = 0
    await sync.run(Date.parse('2026-10-21T20:15:00Z') / 1000)
    expect(calls.filter(c => c.path.includes('/jobs') || c.path.includes('/contents/'))).toEqual([])
  })
})

describe('alerts', () => {
  const at = (secondsAgo: number) => utc(-secondsAgo, NOW * 1000)
  const installation = (id: string, name: string, cronKind = 'real', quietFor = 600, checks: Record<string, string> = { updates: 'ok' }) => ({
    id, kompanie: `Steuten-IT-Solutions/${name}`, variant: 'standalone', cronKind, checks, maintenance: false,
    firstSeen: at(86400), lastHeartbeat: at(quietFor) as string | null,
  })

  it('applies the alert rules like the PHP cockpit', () => {
    const a = installation(ID, 'kompanie-a')
    const b = installation('b'.repeat(32), 'kompanie-b', 'real', 3 * 3600)
    const c = installation('c'.repeat(32), 'kompanie-c', 'pseudo', 3 * 3600)
    const d = installation('d'.repeat(32), 'kompanie-d', 'real', 600, { gallery: 'error', backup: 'warn' })
    const e = { ...installation('e'.repeat(32), 'kompanie-e'), firstSeen: at(3600) }
    const events = [
      { installationId: ID, code: 'UPDATE_FAILED', detail: null, version: '1.4.0.3', receivedAt: at(1800) },
      { installationId: b.id, code: 'PHP_FATAL', detail: null, version: '1.4.0.3', receivedAt: at(2 * 86400) },
      { installationId: d.id, code: 'CHECK_ERROR', detail: null, version: '1.4.0.3', receivedAt: at(600) },
      { installationId: e.id, code: 'DB_ERROR', detail: null, version: '1.4.0.3', receivedAt: at(600) },
    ]
    expect([...wantedAlerts([a, b, c, d, e], events, NOW).keys()].sort()).toEqual([
      `${ID}|event:UPDATE_FAILED`,
      `${'b'.repeat(32)}|silent`,
      `${'d'.repeat(32)}|check:gallery`,
      `${'e'.repeat(32)}|event:DB_ERROR`,
    ])

    // Maintenance: a red light raises nothing; silence still does.
    const m = { ...installation('f'.repeat(32), 'kompanie-f', 'real', 600, { gallery: 'error' }), maintenance: true }
    expect([...wantedAlerts([m], [], NOW).keys()]).toEqual([])
    expect([...wantedAlerts([{ ...m, lastHeartbeat: at(3 * 3600) }], [], NOW).keys()]).toEqual([`${'f'.repeat(32)}|silent`])

    // Two installations known for a day with severe errors on the same version: release alert.
    const wanted = wantedAlerts([a, b, c, d, { ...e, firstSeen: at(2 * 86400) }], events, NOW)
    const release = wanted.get('*|release:1.4.0.3')!
    expect(release.detail).toContain('kompanie-a')
    expect(release.detail).toContain('kompanie-e')
    expect(release.detail).not.toContain('kompanie-d')

    const diff = diffAlerts(wanted, [
      { id: 1, installationId: ID, kompanie: a.kompanie, alertKey: 'event:UPDATE_FAILED' },
      { id: 2, installationId: ID, kompanie: a.kompanie, alertKey: 'silent' },
    ])
    expect(diff.touch).toEqual([{ id: 1, detail: 'Update gescheitert' }])
    expect(diff.resolve).toEqual([2])
    expect(diff.open).toHaveLength(4)
  })

  const alert = (o: Partial<Alert>): Alert => ({
    id: 1, installationId: ID, kompanie: 'Steuten-IT-Solutions/kompanie-a', variant: 'wordpress', alertKey: 'check:gallery',
    detail: 'Galerie: rot', openedAt: '2026-10-18 10:00:00', lastSeenAt: '2026-10-18 10:00:00', notifiedAt: null,
    resolvedAt: null, resolvedNotifiedAt: null, ...o,
  })

  it('writes one message with alerts and all-clears', async () => {
    const [subject, body] = alertMessage([
      alert({}),
      alert({ id: 2, alertKey: 'silent', detail: 'kein Lebenszeichen', notifiedAt: '2026-10-18 09:00:00', resolvedAt: '2026-10-18 11:00:00' }),
    ], 'https://cockpit.example.org')
    expect(subject).toBe('Cockpit: 1 Warnung, 1 Entwarnung')
    expect(body).toContain('- kompanie-a (WordPress): Galerie: rot')
    expect(body).toContain(`https://cockpit.example.org/installation?id=${ID}`)
    expect(body).toContain('Entwarnung (Problem behoben):\n- kompanie-a (WordPress): kein Lebenszeichen')

    const sent: string[][] = []
    const notifier = new Notifier('https://cockpit.example.org', { to: 'ops@example.org', from: 'Cockpit <cockpit@example.org>' }, null, null,
      async (to, from, s) => {
        sent.push([to, from, s])
        return true
      })
    expect(await notifier.send([alert({})], NOW)).toBe(true)
    expect(sent[0]).toEqual(['ops@example.org', 'Cockpit <cockpit@example.org>', 'Cockpit: 1 Warnung'])
  })
})
