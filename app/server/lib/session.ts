import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import type { Database } from './db'
import { webSessions } from '../database/schema'
import { utc, utcSeconds } from './time'

/** What a session remembers between requests. */
export interface SessionData {
  csrf: string
  /** Password accepted, second factor still missing. */
  pendingUser?: number
  pendingAt?: number
  /** One-time message for the next page. */
  flash?: string
  /** First account being set up: name, password hash and the encrypted TOTP secret. */
  setup?: { username: string, passwordHash: string, secretEnc: string }
}

export interface SessionOptions {
  idleTimeout: number
  absoluteTimeout: number
}

/**
 * Server-side session, stored in web_sessions. The cookie holds a random token;
 * the table holds only its SHA-256, so logging out or expiring really ends it.
 */
export class Session {
  private dirty = false

  private constructor(
    private readonly db: Database,
    private tokenValue: string,
    public userId: number | null,
    public data: SessionData,
    private createdAt: string,
  ) {}

  /** The token for the cookie. Changes on regenerate(). */
  get token(): string {
    return this.tokenValue
  }

  /**
   * Loads the session for a cookie token, or starts a new one if there is none or
   * it timed out. touch = false for requests a page makes on its own (polling):
   * they must not keep an idle session alive.
   */
  static async load(db: Database, token: string | undefined, options: SessionOptions, touch = true): Promise<Session> {
    if (token !== undefined && /^[a-f0-9]{64}$/.test(token)) {
      const rows = await db.select().from(webSessions).where(eq(webSessions.id, digest(token))).limit(1)
      const row = rows[0]
      if (row !== undefined) {
        const now = Math.floor(Date.now() / 1000)
        const expired = now - utcSeconds(row.seenAt) > options.idleTimeout
          || now - utcSeconds(row.createdAt) > options.absoluteTimeout
        if (!expired) {
          if (touch) {
            await db.update(webSessions).set({ seenAt: utc() }).where(eq(webSessions.id, row.id))
          }
          return new Session(db, token, row.userId, parse(row.data), row.createdAt)
        }
        await db.delete(webSessions).where(eq(webSessions.id, row.id))
      }
    }
    return Session.start(db, options)
  }

  private static async start(db: Database, options: SessionOptions): Promise<Session> {
    // Remove sessions nobody has used for longer than the idle timeout.
    await db.delete(webSessions).where(lt(webSessions.seenAt, utc(-options.idleTimeout)))
    const session = new Session(db, newToken(), null, { csrf: randomBytes(32).toString('hex') }, utc())
    await db.insert(webSessions).values({
      id: digest(session.token), userId: null, data: JSON.stringify(session.data), createdAt: session.createdAt, seenAt: session.createdAt,
    })
    return session
  }

  /** New token, same data, fresh absolute timeout. Call whenever the login state changes. */
  async regenerate(): Promise<void> {
    const old = digest(this.tokenValue)
    this.tokenValue = newToken()
    this.createdAt = utc()
    await this.db.update(webSessions)
      .set({ id: digest(this.tokenValue), userId: this.userId, data: JSON.stringify(this.data), createdAt: this.createdAt, seenAt: this.createdAt })
      .where(eq(webSessions.id, old))
    this.dirty = false
  }

  async destroy(): Promise<void> {
    await this.db.delete(webSessions).where(eq(webSessions.id, digest(this.tokenValue)))
  }

  update(change: (data: SessionData) => void): void {
    change(this.data)
    this.dirty = true
  }

  setUser(userId: number | null): void {
    this.userId = userId
    this.dirty = true
  }

  /** Reads and removes the one-time message. */
  takeFlash(): string | undefined {
    const message = this.data.flash
    if (message !== undefined) {
      this.update(data => delete data.flash)
    }
    return message
  }

  isValidCsrf(submitted: string | undefined): boolean {
    if (submitted === undefined || submitted.length !== this.data.csrf.length) {
      return false
    }
    return timingSafeEqual(Buffer.from(submitted), Buffer.from(this.data.csrf))
  }

  async save(): Promise<void> {
    if (this.dirty) {
      await this.db.update(webSessions)
        .set({ userId: this.userId, data: JSON.stringify(this.data) })
        .where(eq(webSessions.id, digest(this.tokenValue)))
      this.dirty = false
    }
  }
}

function newToken(): string {
  return randomBytes(32).toString('hex')
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parse(json: string): SessionData {
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object' || value === null || typeof (value as SessionData).csrf !== 'string') {
    return { csrf: randomBytes(32).toString('hex') }
  }
  return value as SessionData
}
