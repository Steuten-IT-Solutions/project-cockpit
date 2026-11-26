import { codeAt } from '../../server/lib/totp'
import { BASE, USER, sql } from './setup'

/** A tiny browser: keeps the session cookie and the CSRF token. */
export class Client {
  cookie = ''
  csrf = ''

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookie !== '') {
      headers.set('cookie', this.cookie)
    }
    if (init.method !== undefined && init.method !== 'GET') {
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

  async json<T>(path: string): Promise<T> {
    const response = await this.request(path)
    if (response.status !== 200) {
      throw new Error(`${path}: ${response.status}`)
    }
    return response.json() as Promise<T>
  }
}

/**
 * A client that is logged in. The replay protection accepts each TOTP step once, so
 * the stored step is reset first: tests may log in several times within 30 seconds.
 */
export async function loggedIn(): Promise<Client> {
  await sql('UPDATE users SET totp_last_step = 0')
  const client = new Client()
  await client.session()
  await client.post('/api/login', { username: USER.username, password: USER.password })
  await client.session()
  const response = await client.post('/api/login/code', { code: codeAt(USER.totp, Math.floor(Date.now() / 30000)) })
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status}`)
  }
  await client.session()
  return client
}
