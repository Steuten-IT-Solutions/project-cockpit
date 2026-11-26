import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, loggedIn } from './client'
import { resetDatabase, sql, startServer, stopServer } from './setup'

// The background jobs end to end: "Jetzt aktualisieren" runs them in the built server
// against a fake GitHub and Vercel API, and the results land in the database exactly
// where the PHP cockpit's cron wrote them.

const API_PORT = 3998
const API = `http://127.0.0.1:${API_PORT}`
const SHA = 'fa3a5f5491ba2023a2833b808987d0519252f21f'
const INSTALLATION = 'c'.repeat(32)

/** Answers of the fake APIs by method and path; every request is recorded. */
function answer(method: string, path: string): [number, unknown] {
  const tpl = '/repos/Org/Kompanie-App-Template'
  const reports = '/repos/Org/meldungen'
  if (path === '/app/installations?per_page=100') return [200, [{ id: 1, account: { login: 'Org' } }]]
  if (path === '/app/installations/1/access_tokens') return [201, { token: 'ghs_test' }]
  if (path === '/installation/repositories?per_page=100') {
    return [200, { repositories: [{
      id: 42, name: 'kompanie-a', full_name: 'Org/kompanie-a', owner: { login: 'Org' }, description: 'Eine Kompanie',
      html_url: 'https://github.com/Org/kompanie-a', private: true, archived: false, fork: false, default_branch: 'main',
      pushed_at: '2026-10-16T19:45:00Z', open_issues_count: 3,
    }] }]
  }
  if (path === '/repos/Org/kompanie-a/releases/latest') return [200, { tag_name: 'v1.0.0', html_url: 'https://github.com/Org/kompanie-a/releases/tag/v1.0.0', published_at: '2026-10-01T08:00:00Z' }]
  if (path.startsWith('/repos/Org/kompanie-a/actions/runs')) {
    return [200, { workflow_runs: [{ status: 'completed', conclusion: 'failure', html_url: 'https://github.com/Org/kompanie-a/actions/runs/9', updated_at: '2026-10-16T19:50:00Z', name: 'CI' }] }]
  }
  if (path.startsWith('/repos/Org/kompanie-a/pulls')) return [200, [{ number: 1 }]]
  if (path.startsWith(`${tpl}/actions/workflows/kern-freigeben.yml/runs`)) {
    return [200, { workflow_runs: [{
      id: 77, name: 'Kernversion freigeben', display_title: 'Release 0.2.0', event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      head_branch: 'main', head_sha: SHA, path: '.github/workflows/kern-freigeben.yml', html_url: 'https://github.com/Org/Kompanie-App-Template/actions/runs/77',
      created_at: '2026-10-21T19:46:26Z', updated_at: '2026-10-21T19:48:16Z', run_started_at: `${new Date().toISOString().slice(0, 19)}Z`,
    }] }]
  }
  if (path.startsWith(`${tpl}/actions/workflows/`)) return [404, { message: 'Not Found' }]
  if (path === `${tpl}/contents/VERSION?ref=${SHA}`) return [200, { encoding: 'base64', content: Buffer.from('0.2.0\n').toString('base64') }]
  if (method === 'GET' && path.startsWith(`${reports}/labels/`)) return [200, {}]
  if (method === 'POST' && path === `${reports}/issues`) return [201, { number: 12, html_url: 'https://github.com/Org/meldungen/issues/12' }]
  // Vercel
  if (path.startsWith('/v10/projects?')) {
    return [200, { projects: [{ id: 'prj_a', name: 'kompanie-a', link: { org: 'Org', repo: 'kompanie-a', repoId: 42 }, alias: [{ domain: 'kompanie-a.de', target: 'PRODUCTION' }] }] }]
  }
  if (path.startsWith('/v7/deployments?')) return [200, { deployments: [{ state: 'READY', created: 1791834710546, inspectorUrl: 'https://vercel.com/org/kompanie-a/1' }] }]
  return [404, { message: 'Not Found' }]
}

describe('background jobs', () => {
  let client: Client
  let api: Server
  const requests: string[] = []
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-jobs-'))
  const mails = join(dir, 'mails.txt')

  beforeAll(async () => {
    api = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      req.resume()
      req.on('end', () => {
        const [status, json] = answer(req.method ?? 'GET', req.url ?? '/')
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
      })
    })
    await new Promise<void>(resolve => api.listen(API_PORT, '127.0.0.1', resolve))

    const key = join(dir, 'github.pem')
    writeFileSync(key, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }))
    // A sendmail stand-in that keeps what it is given.
    const sendmail = join(dir, 'sendmail.sh')
    writeFileSync(sendmail, `#!/bin/sh\necho "ARGS: $*" >> ${mails}\ncat >> ${mails}\n`)
    chmodSync(sendmail, 0o755)

    await resetDatabase()
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const longAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    // An installation silent for three hours: the jobs open an alert and send a mail.
    await sql(`INSERT INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, features, update_check_ok, first_seen, last_seen, last_heartbeat)
      VALUES (?, 'Org/kompanie-a', 'standalone', 'secret', '0.1.0', '8.3', 'mysql', 'real', '{}', '{}', '', 1, ?, ?, ?)`, [INSTALLATION, longAgo, longAgo, longAgo])
    // A bug report waiting for its issue.
    await sql(`INSERT INTO bug_reports (installation_id, report_id, kompanie, payload, received_at) VALUES (?, ?, 'Org/kompanie-a', ?, ?)`,
      [INSTALLATION, 'd'.repeat(32), JSON.stringify({ description: 'Knopf kaputt', expected: '', page: '', version: '0.1.0', variant: 'standalone', userAgent: '', role: 'Mitglied', name: null, lastError: null, created: 1792368000 }), now])

    await startServer({
      NUXT_BASE_URL: 'https://cockpit.example.org',
      NUXT_GITHUB_CLIENT_ID: 'Iv23test',
      NUXT_GITHUB_PRIVATE_KEY_FILE: key,
      NUXT_GITHUB_ACCOUNTS: 'Org',
      NUXT_GITHUB_API_BASE: API,
      NUXT_VERCEL_TOKEN: 'vercel-token',
      NUXT_VERCEL_TEAM_ID: 'team_test',
      NUXT_VERCEL_API_BASE: API,
      NUXT_VERCEL_BILLING: 'false',
      NUXT_RELEASES_REPO: 'Org/Kompanie-App-Template',
      NUXT_STATUS_REPORTS_ORG: 'Org',
      NUXT_BUG_REPORTS_REPO: 'Org/meldungen',
      NUXT_ALERTS_EMAIL: 'ops@example.org',
      NUXT_ALERTS_FROM: 'Cockpit <noreply@example.org>',
      NUXT_MAIL_SENDMAIL: sendmail,
    })
    client = await loggedIn()
  }, 60000)
  afterAll(async () => {
    stopServer()
    await new Promise(resolve => api.close(resolve))
  })

  it('needs a login', async () => {
    const anonymous = new Client()
    await anonymous.session()
    expect((await anonymous.post('/api/refresh', {})).status).toBe(401)
  })

  it('runs every source and records the run', async () => {
    const response = await client.post('/api/refresh', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', message: 'Aktualisiert.' })

    const [run] = await sql('SELECT php_version, php_sapi, status, message, finished_at FROM cron_runs ORDER BY id DESC LIMIT 1') as Record<string, string>[]
    expect(run!.php_sapi).toBe('node')
    expect(run!.php_version).toMatch(/^node \d+\./)
    expect(run!.status).toBe('ok')
    expect(run!.finished_at).not.toBeNull()
    expect(run!.message).toBe('Manuell gestartet · GitHub: 1 Repos aktualisiert · Releases: 1 Läufe geprüft · Vercel: 1 Projekte · Warnungen: 1 neu, 0 behoben · Fehlermeldungen: 1 als Issue angelegt')
  })

  it('stores what the PHP cron stored', async () => {
    const [project] = await sql('SELECT full_name, open_issues, open_prs, release_tag, ci_conclusion, CAST(pushed_at AS CHAR) AS pushed_at, available FROM projects WHERE id = 42') as Record<string, unknown>[]
    expect(project).toEqual({ full_name: 'Org/kompanie-a', open_issues: 2, open_prs: 1, release_tag: 'v1.0.0', ci_conclusion: 'failure', pushed_at: '2026-10-16 19:45:00', available: 1 })

    const [vercel] = await sql('SELECT repo_id, production_domain, deploy_state FROM vercel_projects WHERE id = \'prj_a\'') as Record<string, unknown>[]
    expect(vercel).toEqual({ repo_id: 42, production_domain: 'kompanie-a.de', deploy_state: 'READY' })

    const [release] = await sql('SELECT workflow, channel, publishing, core_version FROM release_runs WHERE id = 77') as Record<string, unknown>[]
    expect(release).toEqual({ workflow: 'promote', channel: 'stable', publishing: 1, core_version: '0.2.0' })

    const [alert] = await sql('SELECT alert_key, notified_at IS NOT NULL AS notified FROM alerts WHERE installation_id = ?', [INSTALLATION]) as Record<string, unknown>[]
    expect(alert).toEqual({ alert_key: 'silent', notified: 1 })
    const mail = readFileSync(mails, 'utf8')
    expect(mail).toContain('ARGS: -i -f noreply@example.org -- ops@example.org')
    expect(mail).toContain('Subject: Cockpit: 1 Warnung')
    expect(mail).toContain(`https://cockpit.example.org/installation?id=${INSTALLATION}`)

    const [report] = await sql('SELECT issue_number, payload, done_at IS NOT NULL AS done FROM bug_reports') as Record<string, unknown>[]
    expect(report).toEqual({ issue_number: 12, payload: '{}', done: 1 })
    expect(requests).toContain('POST /repos/Org/meldungen/issues')
  })

  it('refuses a second run within a minute', async () => {
    const response = await client.post('/api/refresh', {})
    const result = await response.json() as { status: string, message: string }
    expect(result.status).toBe('wait')
    expect(result.message).toMatch(/^Gerade erst aktualisiert\. Bitte in \d+ Sekunden erneut versuchen\.$/)
  })

  it('waits while another process (e.g. the PHP cron) holds the lock', async () => {
    await sql('UPDATE cron_runs SET started_at = \'2020-01-01 00:00:00\'')
    const mysql = await import('mysql2/promise')
    const { databaseUrl } = await import('./setup')
    const other = await mysql.createConnection({ uri: databaseUrl })
    try {
      await other.query('SELECT GET_LOCK(\'cockpit_cron\', 0)')
      const result = await (await client.post('/api/refresh', {})).json()
      expect(result).toEqual({ status: 'locked', message: 'Es läuft gerade schon eine Aktualisierung. Bitte gleich neu laden.' })
    }
    finally {
      await other.end()
    }
  })
})
