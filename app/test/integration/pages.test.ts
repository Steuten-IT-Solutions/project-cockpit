import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Client, loggedIn } from './client'
import { resetDatabase, sql, startServer, stopServer } from './setup'

// Costs, alerts, installations and push subscriptions through the API.

const INSTALLATION = 'b'.repeat(32)

describe('costs, alerts, installations', () => {
  let client: Client

  beforeAll(async () => {
    await resetDatabase()
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await sql(`INSERT INTO projects (id, full_name, owner, name, html_url, is_private, is_archived, is_fork, default_branch, synced_at) VALUES (5, 'Org/p', 'Org', 'p', 'https://github.com/Org/p', 0, 0, 0, 'main', ?)`, [now])
    await sql(`INSERT INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, details, features, update_check_ok, usage_counts, first_seen, last_seen)
      VALUES (?, 'Org/p', 'wordpress', 'secret', '1.0.0', '8.3', 'mysql', 'wp', '{}', '[]', NULL, '', 1, '{"users":3,"d1":1,"d7":2,"d30":3,"areas":{"news":2}}', ?, ?)`, [INSTALLATION, now, now])
    await sql(`INSERT INTO status_events (installation_id, code, detail, version, received_at) VALUES (?, 'DB_ERROR', NULL, '1.0.0', ?)`, [INSTALLATION, now])
    await sql(`INSERT INTO alerts (installation_id, kompanie, variant, alert_key, detail, opened_at, last_seen_at) VALUES (?, 'Org/p', 'wordpress', 'silent', 'still', ?, ?)`, [INSTALLATION, now, now])
    await startServer()
    client = await loggedIn()
  }, 60000)
  afterAll(stopServer)

  it('adds, edits and deletes costs', async () => {
    let response = await client.post('/api/costs', { name: 'Server', amount: '12,5', currency: 'EUR', interval: 'month', project: '5' })
    expect(await response.json()).toEqual({ message: 'Server hinzugefügt.' })
    response = await client.post('/api/costs', { name: 'X', amount: 'zwölf', currency: 'EUR', interval: 'month' })
    expect(response.status).toBe(422)
    let page = await client.json<{ costs: { id: number, amountCents: number, projectName: string | null }[] }>('/api/costs')
    expect(page.costs).toMatchObject([{ amountCents: 1250, projectName: 'p' }])
    const id = page.costs[0]!.id
    response = await client.request(`/api/costs/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'Server', amount: '13', currency: 'USD', interval: 'year' }) })
    expect(await response.json()).toEqual({ message: 'Server gespeichert.' })
    page = await client.json('/api/costs')
    expect(page.costs).toMatchObject([{ amountCents: 1300, projectName: null }])
    expect((await client.request(`/api/costs/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await client.request(`/api/costs/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('shows an installation without its secret', async () => {
    const page = await client.json<{ installation: { errors: object }, history: { type: string, code: string | null }[], alerts: unknown[], usage: { users: number } | null }>(`/api/installations/${INSTALLATION}`)
    expect(page.installation.errors).toEqual({})
    expect(page.history).toMatchObject([{ type: 'event', code: 'DB_ERROR' }])
    expect(page.alerts).toHaveLength(1)
    expect(page.usage?.users).toBe(3)
    expect(JSON.stringify(page)).not.toContain('secret')
    expect((await client.request('/api/installations/xyz')).status).toBe(404)
    expect((await client.request(`/api/installations/${'c'.repeat(32)}`)).status).toBe(404)
  })

  it('lists alerts and refuses push without configuration', async () => {
    const page = await client.json<{ alerts: unknown[], pushConfigured: boolean }>('/api/alerts')
    expect(page.alerts).toHaveLength(1)
    expect(page.pushConfigured).toBe(false)
    const response = await client.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' })
    expect(response.status).toBe(400)
  })
})
