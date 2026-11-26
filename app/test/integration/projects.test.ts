import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Dashboard, ProjectPage } from '../../shared/types/cockpit'
import { type Client, loggedIn } from './client'
import { resetDatabase, sql, startServer, stopServer } from './setup'

// The overview and the project page read what the PHP cockpit's sync wrote.

describe('projects', () => {
  let client: Client

  beforeAll(async () => {
    await resetDatabase()
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await sql(`INSERT INTO projects (id, full_name, owner, name, html_url, is_private, is_archived, is_fork, default_branch, pushed_at, release_tag, synced_at, hidden)
      VALUES (1, 'Org/kompanie-a', 'Org', 'kompanie-a', 'https://github.com/Org/kompanie-a', 1, 0, 0, 'main', ?, 'v0.2.0', ?, 0),
             (2, 'Org/old', 'Org', 'old', 'https://github.com/Org/old', 0, 1, 0, 'main', NULL, NULL, ?, 1)`, [now, now, now])
    await sql(`INSERT INTO vercel_projects (id, name, repo_id, repo_full_name, deploy_state, synced_at) VALUES ('prj_a', 'a', NULL, 'org/KOMPANIE-A', 'READY', ?), ('prj_b', 'b', NULL, NULL, 'ERROR', ?)`, [now, now])
    await sql(`INSERT INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, features, update_check_ok, first_seen, last_seen)
      VALUES (REPEAT('a', 32), 'Org/kompanie-a', 'standalone', 'secret', '0.1.0', '8.3', 'mysql', 'real', '{"gallery":"warn"}', '{}', 'news', 1, ?, ?)`, [now, now])
    await sql(`INSERT INTO status_reports (kompanie, variant, version, php, db_driver, update_check_ok, received_at) VALUES ('Org/kompanie-a', 'standalone', '0.0.9', '8.2', 'mysql', 1, ?)`, [now])
    await startServer()
    client = await loggedIn()
  }, 60000)
  afterAll(stopServer)

  it('needs a login', async () => {
    const response = await fetch('http://127.0.0.1:3999/api/dashboard')
    expect(response.status).toBe(401)
  })

  it('groups the overview', async () => {
    const d = await client.json<Dashboard>('/api/dashboard')
    expect(d.projects?.map(p => p.id)).toEqual([1])
    expect(d.hiddenCount).toBe(1)
    expect(d.vercelByRepo[1]?.map(v => v.id)).toEqual(['prj_a'])
    expect(d.vercelUnmatched.map(v => v.id)).toEqual(['prj_b'])
    expect(d.installationsByRepo[1]).toEqual(['a'.repeat(32)])
    // The format 1 row of a variant that sends format 2 is left out.
    expect(d.reports).toEqual([])
    expect(d.installations[0]?.checks).toEqual({ gallery: 'warn' })
    expect(JSON.stringify(d)).not.toContain('secret')
    const all = await client.json<Dashboard>('/api/dashboard?all=1')
    expect(all.projects?.map(p => p.id)).toEqual([1, 2])
  })

  it('saves notes as versions and hides a project', async () => {
    let response = await client.post('/api/projects/1/note', { body: 'Erste\r\nNotiz' })
    expect(await response.json()).toEqual({ message: 'Notiz gespeichert.' })
    response = await client.post('/api/projects/1/note', { body: 'Erste\nNotiz' })
    expect(await response.json()).toEqual({ message: 'Keine Änderung – nichts gespeichert.' })
    await client.post('/api/projects/1/note', { body: 'Zweite' })
    response = await client.post('/api/projects/1/visibility', { hidden: true })
    expect(response.status).toBe(200)

    const page = await client.json<ProjectPage>('/api/projects/1')
    expect(page.history.map(n => n.body)).toEqual(['Zweite', 'Erste\nNotiz'])
    expect(page.project.hidden).toBe(true)
    expect(page.project.hasNote).toBe(true)
    expect(page.vercel.map(v => v.id)).toEqual(['prj_a'])
  })

  it('answers 404 for unknown projects and refuses notes without a token', async () => {
    expect((await client.request('/api/projects/99')).status).toBe(404)
    expect((await client.request('/api/projects/abc')).status).toBe(404)
    const csrf = client.csrf
    client.csrf = 'wrong'
    expect((await client.post('/api/projects/1/note', { body: 'x' })).status).toBe(403)
    client.csrf = csrf
    const tooLong = await client.post('/api/projects/1/note', { body: 'x'.repeat(100_001) })
    expect(tooLong.status).toBe(422)
  })
})
