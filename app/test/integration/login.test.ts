import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeAt } from '../../server/lib/totp'
import { BASE, USER, resetDatabase, startServer, stopServer } from './setup'

/** A tiny browser: keeps the session cookie and the CSRF token. */
class Client {
  cookie = ''
  csrf = ''

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookie !== '') {
      headers.set('cookie', this.cookie)
    }
    if (init.method === 'POST') {
      headers.set('content-type', 'application/json')
      headers.set('x-csrf-token', this.csrf)
    }
    const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' })
    const set = response.headers.getSetCookie().find(c => c.startsWith('cockpit_session_dev='))
    if (set !== undefined) {
      this.cookie = set.split(';')[0]!
    }
    return response
  }

  async session() {
    const state = await (await this.request('/api/session')).json() as { user: { username: string } | null, pending: boolean, csrf: string, flash: string | null }
    this.csrf = state.csrf
    return state
  }

  post(path: string, body: unknown): Promise<Response> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) })
  }
}

const totpNow = () => codeAt(USER.totp, Math.floor(Date.now() / 30000))

describe('login', () => {
  beforeAll(async () => {
    await resetDatabase()
    await startServer()
  }, 60000)
  afterAll(stopServer)

  it('sends the security headers', async () => {
    const response = await fetch(`${BASE}/login`)
    expect(response.status).toBe(200)
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("script-src 'self' 'nonce-")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    const cookie = response.headers.getSetCookie().join()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('redirects pages to the login when logged out', async () => {
    const response = await fetch(`${BASE}/`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login')
  })

  it('rejects requests without a valid CSRF token', async () => {
    const client = new Client()
    await client.session()
    client.csrf = 'wrong'
    const response = await client.post('/api/login', { username: USER.username, password: USER.password })
    expect(response.status).toBe(403)
  })

  it('rejects requests from another origin', async () => {
    const client = new Client()
    await client.session()
    const response = await client.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: USER.username, password: USER.password }),
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('logs in with password and TOTP code, then logs out', async () => {
    const client = new Client()
    expect((await client.session()).user).toBeNull()

    const wrong = await client.post('/api/login', { username: USER.username, password: 'wrong' })
    expect(wrong.status).toBe(401)

    const before = client.cookie
    const first = await client.post('/api/login', { username: USER.username, password: USER.password })
    expect(first.status).toBe(200)
    expect(client.cookie).not.toBe(before) // new session id after the password step
    expect((await client.session()).pending).toBe(true)

    const second = await client.post('/api/login/code', { code: totpNow() })
    expect(second.status).toBe(200)
    const state = await client.session()
    expect(state.user?.username).toBe(USER.username)

    // The same code cannot be used twice.
    const other = new Client()
    await other.session()
    await other.post('/api/login', { username: USER.username, password: USER.password })
    await other.session()
    expect((await other.post('/api/login/code', { code: totpNow() })).status).toBe(401)

    expect((await client.post('/api/logout', {})).status).toBe(200)
    expect((await client.session()).user).toBeNull()
  })

  it('logs in with a recovery code once and says how many are left', async () => {
    const client = new Client()
    await client.session()
    await client.post('/api/login', { username: USER.username, password: USER.password })
    await client.session()
    expect((await client.post('/api/login/code', { code: USER.recovery.toLowerCase() })).status).toBe(200)
    const state = await client.session()
    expect(state.user?.username).toBe(USER.username)
    expect(state.flash).toContain('noch 0 übrig')

    const again = new Client()
    await again.session()
    await again.post('/api/login', { username: USER.username, password: USER.password })
    await again.session()
    expect((await again.post('/api/login/code', { code: USER.recovery })).status).toBe(401)
  })

  it('refuses the code step without a password step', async () => {
    const client = new Client()
    await client.session()
    expect((await client.post('/api/login/code', { code: totpNow() })).status).toBe(409)
  })

  it('blocks an account after five failures', async () => {
    const client = new Client()
    await client.session()
    // Earlier tests left at most one failure for the account; at the latest the
    // fifth failure from here blocks it, and then even the right password is refused.
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      statuses.push((await client.post('/api/login', { username: USER.username, password: 'wrong' })).status)
    }
    expect(statuses).toContain(429)
    const response = await client.post('/api/login', { username: USER.username, password: USER.password })
    expect(response.status).toBe(429)
  })
})
