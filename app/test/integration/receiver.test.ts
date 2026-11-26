import { createHmac, randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Crypto, deriveAppKey } from '../../server/lib/crypto'
import { APP_KEY, BASE, resetDatabase, sql, startServer, stopServer } from './setup'

// The status subdomain end to end against MariaDB, with the expectations of the PHP
// cockpit's tests (tests/Unit/StatusFormat2Test.php, StatusReportTest.php, BugReportTest.php,
// ReleaseTest.php). Apache forwards status.steuten-it-solutions.de/<path> to /_receiver/<path>.

const ORG = 'Org'
const ID = '0123456789abcdef0123456789abcdef'
const SECRET = 'a'.repeat(64)
const WEBHOOK_SECRET = 'webhook-secret-with-at-least-32-chars'
const HOST = '127.0.0.1:3999'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADElEQVQImWNgIAoAAAAnAAGfWjwcAAAAAElFTkSuQmCC'
const now = () => Math.floor(Date.now() / 1000)
const nonce = () => randomBytes(8).toString('hex')
const signature = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function heartbeat(o: Record<string, unknown> = {}) {
  return {
    format: 2, installation: ID, kompanie: `${ORG}/kompanie-musterstadt`, version: '1.4.0.3', variant: 'standalone', php: '8.3', database: 'sqlite',
    kind: 'heartbeat', checks: { updates: 'ok', gallery: 'error' }, errors: { GALLERY_SYNC: 2 }, cron: { kind: 'real', last: now() - 300 },
    features: ['events', 'gallery'], update: { ok: true, at: now() - 3600, to: '1.4.0.3' }, updateCheckOk: true, sent: now() - 5, nonce: nonce(), ...o,
  }
}

/** POSTs a report; signs it with `secret` unless that is null. Returns status and the JSON "code". */
async function post(path: string, payload: unknown, secret: string | null = SECRET, headers: Record<string, string> = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const response = await fetch(`${BASE}/_receiver${path}`, {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-kompanie-signature': signature(body, secret) }), ...headers },
  })
  const data = await response.json() as Record<string, unknown>
  return [response.status, String(data.code ?? (data.duplicate ? 'duplicate' : ''))] as const
}

describe('receiver', () => {
  beforeAll(async () => {
    await resetDatabase()
    await startServer({
      NUXT_RECEIVER_HOST: HOST,
      NUXT_STATUS_REPORTS_ORG: ORG,
      // Bug reports need a GitHub App; nothing is reachable here, so the issue stays pending.
      NUXT_GITHUB_CLIENT_ID: 'Iv23test',
      NUXT_GITHUB_PRIVATE_KEY_FILE: '/nonexistent/key.pem',
      NUXT_GITHUB_ACCOUNTS: ORG,
      NUXT_GITHUB_API_BASE: 'http://127.0.0.1:9',
      NUXT_BUG_REPORTS_REPO: `${ORG}/meldungen`,
      NUXT_RELEASES_REPO: `${ORG}/Kompanie-App-Template`,
      NUXT_RELEASES_WEBHOOK_SECRET: WEBHOOK_SECRET,
    })
  }, 60000)
  afterAll(stopServer)

  it('answers 404 JSON with strict headers for anything else', async () => {
    const response = await fetch(`${BASE}/_receiver/`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBe('default-src \'none\'; frame-ancestors \'none\'')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect((await fetch(`${BASE}/_receiver/other`, { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('answers only for the status host', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: 3999, path: '/_receiver/', method: 'POST', headers: { host: 'cockpit.example.org' } }, res => resolve(res.statusCode ?? 0))
      req.on('error', reject)
      req.end(JSON.stringify(heartbeat({ key: SECRET })))
    })
    expect(status).toBe(404)
  })

  it('trusts on first use and checks signatures (format 2)', async () => {
    expect(await post('/', heartbeat())).toEqual([409, 'unknown_installation'])
    expect(await post('/', heartbeat({ key: SECRET }), 'b'.repeat(64))).toEqual([401, 'bad_signature'])
    expect(await sql('SELECT id FROM installations')).toEqual([])
    expect(await post('/', heartbeat({ key: SECRET }))).toEqual([201, ''])
    const [row] = await sql('SELECT secret_enc, checks, errors, features, last_heartbeat IS NOT NULL AS beat FROM installations WHERE id = ?', [ID]) as Record<string, unknown>[]
    expect(row!.secret_enc).not.toBe(SECRET)
    expect(new Crypto(deriveAppKey(APP_KEY)).decrypt(String(row!.secret_enc))).toBe(SECRET)
    expect([row!.checks, row!.errors, row!.features, row!.beat]).toEqual(['{"updates":"ok","gallery":"error"}', '{"GALLERY_SYNC":2}', 'events,gallery', 1])

    // Later reports: the stored secret decides; another key never replaces it.
    expect(await post('/', heartbeat({ kind: 'event', event: 'UPDATE_FAILED', detail: 'download_http_503' }))).toEqual([201, ''])
    const other = 'c'.repeat(64)
    expect(await post('/', heartbeat({ key: other }), other)).toEqual([401, 'bad_signature'])
    expect(await post('/', heartbeat(), null)).toEqual([401, 'bad_signature'])
    // The signature proves the installation: a renamed company repository is taken over.
    expect(await post('/', heartbeat({ kompanie: `${ORG}/kompanie-neu` }))).toEqual([201, ''])
    expect(await sql('SELECT kompanie FROM installations')).toEqual([{ kompanie: `${ORG}/kompanie-neu` }])
    expect(await sql('SELECT code, detail FROM status_events')).toEqual([{ code: 'UPDATE_FAILED', detail: 'download_http_503' }])
    expect(await sql('SELECT COUNT(*) AS n FROM status_heartbeats')).toEqual([{ n: 2 }])
  })

  it('blocks replays', async () => {
    const payload = heartbeat()
    expect(await post('/', payload)).toEqual([201, ''])
    expect(await post('/', payload)).toEqual([409, 'replay'])
    expect(await post('/', heartbeat({ sent: now() - 601 }))).toEqual([409, 'replay'])
    expect(await post('/', heartbeat({ sent: now() + 601 }))).toEqual([409, 'replay'])
  })

  it('stores usage figures of format 3 per day', async () => {
    const usage = { users: 42, active: { d1: 12, d7: 30, d30: 38 }, areas: { app: 20, events: 35 } }
    expect(await post('/', heartbeat({ format: 3, usage }))).toEqual([201, ''])
    const [row] = await sql('SELECT usage_counts FROM installations WHERE id = ?', [ID]) as { usage_counts: string }[]
    expect(JSON.parse(row!.usage_counts)).toEqual({ users: 42, d1: 12, d7: 30, d30: 38, areas: { app: 20, events: 35 } })
    expect(await sql('SELECT users, d1, d7, d30, areas FROM status_usage')).toEqual([{ users: 42, d1: 12, d7: 30, d30: 38, areas: '{"app":20,"events":35}' }])
    expect(await post('/', heartbeat({ format: 3, usage: { ...usage, users: -1 } }))).toEqual([400, 'invalid'])
  })

  it('lets only companies with a repository register', async () => {
    await sql(`INSERT INTO projects (id, full_name, owner, name, html_url, is_private, is_archived, is_fork, default_branch, synced_at) VALUES (1, '${ORG}/Kompanie-B', '${ORG}', 'Kompanie-B', 'https://github.com/${ORG}/Kompanie-B', 1, 0, 0, 'main', UTC_TIMESTAMP())`)
    expect(await post('/', heartbeat({ installation: 'e'.repeat(32), kompanie: `${ORG}/erfunden`, key: SECRET }))).toEqual([403, 'unknown_company'])
    expect(await post('/', heartbeat({ installation: 'e'.repeat(32), kompanie: `${ORG}/kompanie-b`, key: SECRET }))).toEqual([201, ''])
  })

  it('accepts format 1 unsigned', async () => {
    const report = { format: 1, kompanie: `${ORG}/kompanie-alt`, version: '1.3.0.0', variant: 'wordpress', php: '8.2', database: 'mysql', updateCheckOk: true, sent: now() - 60 }
    const response = await fetch(`${BASE}/_receiver/`, { method: 'POST', body: JSON.stringify(report) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(await sql('SELECT kompanie, variant, version, php, db_driver, update_ok, update_check_ok FROM status_reports')).toEqual([
      { kompanie: `${ORG}/kompanie-alt`, variant: 'wordpress', version: '1.3.0.0', php: '8.2', db_driver: 'mysql', update_ok: null, update_check_ok: 1 },
    ])
  })

  describe('bug reports', () => {
    const installation = 'f'.repeat(32)
    const report = (o: Record<string, unknown> = {}, r: Record<string, unknown> = {}) => ({
      format: 1, installation, kompanie: `${ORG}/kompanie-b`, sent: now() - 5, nonce: nonce(),
      report: {
        id: randomBytes(16).toString('hex'), description: 'Der Knopf geht nicht\nZweite Zeile', expected: 'Dass er geht', page: '#/termine',
        version: '1.4.0.3', variant: 'standalone', userAgent: 'Mozilla/5.0 (Test)', role: 'Mitglied', name: null, lastError: null, created: now() - 60, ...r,
      },
      screenshot: null,
      ...o,
    })

    it('learns the secret from the first report and stores the screenshot', async () => {
      expect(await post('/reports', report())).toEqual([409, 'unknown_installation'])
      const first = report({ key: SECRET, screenshot: { type: 'image/png', data: PNG } }, { name: 'Max' })
      expect(await post('/reports', first)).toEqual([201, ''])
      const [row] = await sql('SELECT kompanie, payload, screenshot, screenshot_type FROM bug_reports') as Record<string, unknown>[]
      expect(row!.screenshot_type).toBe('image/png')
      expect(Buffer.from(row!.screenshot as Buffer).toString('base64')).toBe(PNG)
      expect(JSON.parse(String(row!.payload))).toMatchObject({ description: 'Der Knopf geht nicht\nZweite Zeile', name: 'Max', variant: 'standalone' })
      // Sent again because the app missed the answer: no second report.
      expect(await post('/reports', { ...first, nonce: nonce() })).toEqual([200, 'duplicate'])
      expect(await sql('SELECT COUNT(*) AS n FROM bug_reports')).toEqual([{ n: 1 }])
      // The learned secret decides from now on.
      expect(await post('/reports', report({ key: 'c'.repeat(64) }), 'c'.repeat(64))).toEqual([401, 'bad_signature'])
      expect(await post('/reports', report())).toEqual([201, ''])
    })

    it('accepts a large screenshot and refuses an oversized body', async () => {
      // A PNG header followed by filler: about 2.6 MB of base64, under MAX_BODY (3 MB).
      const png = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(1_900_000)])
      expect(await post('/reports', report({ screenshot: { type: 'image/png', data: png.toString('base64') } }))).toEqual([201, ''])
      const response = await fetch(`${BASE}/_receiver/reports`, { method: 'POST', body: ' '.repeat(3_000_001) })
      expect(response.status).toBe(413)
    })

    it('rejects invalid reports', async () => {
      expect(await post('/reports', report({}, { variant: 'other' }))).toEqual([400, 'invalid'])
      expect(await post('/reports', report({ screenshot: { type: 'image/jpeg', data: PNG } }))).toEqual([400, 'invalid'])
      expect(await post('/reports', '{nope')).toEqual([400, 'invalid'])
    })
  })

  describe('GitHub webhook', () => {
    const run = {
      id: 39664542607, name: 'Kompanien abgleichen', display_title: 'Merge pull request #103', event: 'push', status: 'in_progress', conclusion: null,
      head_branch: 'develop', head_sha: 'fa3a5f5491ba2023a2833b808987d0519252f21f', path: '.github/workflows/kompanien-abgleichen.yml',
      html_url: 'https://github.com/Org/Kompanie-App-Template/actions/runs/39664542607', created_at: '2026-10-21T19:46:26Z', updated_at: '2026-10-21T19:46:30Z',
      run_started_at: '2026-10-21T19:46:26Z',
    }
    const deliver = async (event: string, payload: unknown, secret = WEBHOOK_SECRET) => {
      const body = JSON.stringify(payload)
      const response = await fetch(`${BASE}/_receiver/github`, {
        method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': signature(body, secret) },
      })
      return response.status
    }

    it('checks the signature and the repository', async () => {
      expect(await deliver('workflow_run', { repository: { full_name: 'Org/Kompanie-App-Template' }, workflow_run: run }, 'wrong-secret-with-at-least-32-chars!')).toBe(401)
      expect(await deliver('ping', { zen: 'Keep it logically awesome.' })).toBe(200)
      expect(await deliver('workflow_run', { repository: { full_name: 'Org/other' }, workflow_run: run })).toBe(200)
      expect(await sql('SELECT id FROM release_runs')).toEqual([])
    })

    it('records runs and publishing jobs', async () => {
      expect(await deliver('workflow_run', { repository: { full_name: 'org/kompanie-app-template' }, workflow_run: run })).toBe(200)
      expect(await sql('SELECT workflow, channel, status, publishing FROM release_runs')).toEqual([{ workflow: 'sync', channel: 'early', status: 'in_progress', publishing: null }])
      expect(await deliver('workflow_job', { repository: { full_name: 'Org/Kompanie-App-Template' }, workflow_job: { run_id: run.id, name: 'veroeffentlichen (Org/kompanie-b) / build', conclusion: null } })).toBe(200)
      expect(await sql('SELECT publishing FROM release_runs')).toEqual([{ publishing: 1 }])
      // An older delivery does not restore an older state.
      expect(await deliver('workflow_run', { repository: { full_name: 'Org/Kompanie-App-Template' }, workflow_run: { ...run, status: 'completed', conclusion: 'success', updated_at: '2026-10-21T19:50:00Z' } })).toBe(200)
      expect(await deliver('workflow_run', { repository: { full_name: 'Org/Kompanie-App-Template' }, workflow_run: run })).toBe(200)
      expect(await sql('SELECT status, conclusion FROM release_runs')).toEqual([{ status: 'completed', conclusion: 'success' }])
    })
  })
})
