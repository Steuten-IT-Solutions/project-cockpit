import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeAt } from '../../server/lib/totp'
import { Client } from './client'
import { BASE, resetDatabase, sql, startServer, stopServer } from './setup'

// The first account of a fresh installation, as with the PHP setup page.

const TOKEN = 'setup-token-that-is-at-least-32-characters'

describe('setup', () => {
  beforeAll(async () => {
    await resetDatabase()
    await sql('DELETE FROM recovery_codes')
    await sql('DELETE FROM users')
    await startServer({ NUXT_SETUP_TOKEN: TOKEN })
  }, 60000)
  afterAll(stopServer)

  it('exists only with the right token', async () => {
    expect((await fetch(`${BASE}/api/setup?token=wrong`)).status).toBe(404)
    expect((await fetch(`${BASE}/api/setup`)).status).toBe(404)
    expect((await fetch(`${BASE}/api/setup?token=${TOKEN}`)).status).toBe(200)
    expect((await fetch(`${BASE}/setup?token=${TOKEN}`)).status).toBe(200)
    expect((await fetch(`${BASE}/setup?token=wrong`)).status).toBe(404)
  })

  it('creates the account with a second factor and recovery codes', async () => {
    const client = new Client()
    await client.session()
    let response = await client.post('/api/setup/start', { token: TOKEN, username: 'christian', password: 'kurz', passwordConfirm: 'kurz' })
    expect(response.status).toBe(422)
    expect((await response.json()).message).toBe('Das Passwort muss mindestens 12 Zeichen lang sein.')

    response = await client.post('/api/setup/start', { token: TOKEN, username: 'christian', password: 'ein langes passwort', passwordConfirm: 'ein langes passwort' })
    expect(response.status).toBe(200)
    const { qr, secret } = await response.json() as { qr: string, secret: string }
    expect(qr).toMatch(/^data:image\/png;base64,/)
    expect(secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)

    response = await client.post('/api/setup/confirm', { token: TOKEN, code: '000000' })
    expect(response.status).toBe(422)
    const step = Math.floor(Date.now() / 1000 / 30)
    response = await client.post('/api/setup/confirm', { token: TOKEN, code: codeAt(secret.replaceAll(' ', ''), step) })
    expect(response.status).toBe(200)
    const { codes } = await response.json() as { codes: string[] }
    expect(codes).toHaveLength(10)
    expect(codes[0]).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)

    expect(await sql('SELECT username FROM users')).toEqual([{ username: 'christian' }])
    expect(await sql('SELECT COUNT(*) AS n FROM recovery_codes')).toEqual([{ n: 10 }])
    // Gone once an account exists.
    expect((await fetch(`${BASE}/api/setup?token=${TOKEN}`)).status).toBe(404)

    // The new account can log in.
    const login = new Client()
    await login.session()
    expect((await login.post('/api/login', { username: 'christian', password: 'ein langes passwort' })).status).toBe(200)
  })
})
