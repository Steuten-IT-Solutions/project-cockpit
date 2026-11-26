import { type ChildProcess, spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { Crypto, deriveAppKey } from '../../server/lib/crypto'
import { hashPassword } from '../../server/lib/password'

// Starts the built server (.output) against a fresh database with all migrations
// of ../migrations applied and one user, like the cutover will find it.

export const APP_KEY = 'integration-test-key-that-is-long-enough-0123456789'
export const USER = { username: 'christian', password: 'correct horse battery staple', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', recovery: 'ABCDE-FGHJK' }
export const PORT = 3999
export const BASE = `http://127.0.0.1:${PORT}`

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'mysql://cockpit:cockpit@127.0.0.1:3306/cockpit_test'

export async function resetDatabase(): Promise<void> {
  const url = new URL(databaseUrl)
  const name = url.pathname.slice(1)
  const admin = await mysql.createConnection({ uri: databaseUrl.replace(`/${name}`, '/'), multipleStatements: true })
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\`; CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await admin.end()

  const db = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true })
  const dir = join(import.meta.dirname, '../../../migrations')
  for (const file of readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    await db.query(readFileSync(join(dir, file), 'utf8'))
  }
  const crypto = new Crypto(deriveAppKey(APP_KEY))
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const [result] = await db.execute(
    'INSERT INTO users (username, password_hash, totp_secret_enc, totp_last_step, created_at) VALUES (?, ?, ?, 0, ?)',
    [USER.username, await hashPassword(USER.password), crypto.encrypt(USER.totp), now],
  )
  const userId = (result as { insertId: number }).insertId
  await db.execute('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, crypto.hash('recovery', 'ABCDEFGHJK')])
  await db.end()
}

let server: ChildProcess | undefined

export async function startServer(): Promise<void> {
  server = spawn(process.execPath, [join(import.meta.dirname, '../../.output/server/index.mjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NUXT_APP_KEY: APP_KEY, NUXT_DATABASE_URL: databaseUrl, NUXT_SECURE_COOKIES: 'false' },
    stdio: 'inherit',
  })
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/api/session`)
      return
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw new Error('The server did not start.')
}

export function stopServer(): void {
  server?.kill()
}
