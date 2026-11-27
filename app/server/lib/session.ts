import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
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
 * Idle timeout of a session nobody is logged in with (also during login or setup). Such sessions exist
 * for every visitor of the login page, bots included; a short life keeps the table small.
 */
export const ANONYMOUS_IDLE_SECONDS = 30 * 60

/**
 * Server-side session, stored in web_sessions. The cookie holds a random token;
 * the table holds only its SHA-256, so logging out or expiring really ends it.
 *
 * A new session is stored only once it is needed: when its CSRF token is handed to a page
 * or something is saved in it. Requests without a cookie that need neither (a bot asking
 * for /api/... or a missing file) leave no row behind and get no cookie.
 */
export class Session {
  private dirty = false
  /** The CSRF token was read for an answer, so the session must outlive this request. */
  private needed = false

  private constructor(
    private readonly db: Database,
    private readonly options: SessionOptions,
    private tokenValue: string,
    public userId: number | null,
    public data: SessionData,
    private createdAt: string,
    /** Whether the row exists in web_sessions. */
    private stored: boolean,
  ) {}

  /** The token for the cookie. Changes on regenerate(). */
  get token(): string {
    return this.tokenValue
  }

  /** Whether the visitor must get (or keep) the cookie: false for a new session that was never needed. */
  get isStored(): boolean {
    return this.stored
  }

  /** The CSRF token for the page. Reading it keeps the session, so the next POST can check it. */
  get csrf(): string {
    this.needed = true
    return this.data.csrf
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
        const data = parse(row.data)
        const idle = row.userId === null ? anonymousIdle(options) : options.idleTimeout
        const expired = now - utcSeconds(row.seenAt) > idle
          || now - utcSeconds(row.createdAt) > options.absoluteTimeout
        if (!expired) {
          if (touch) {
            await db.update(webSessions).set({ seenAt: utc() }).where(eq(webSessions.id, row.id))
          }
          return new Session(db, options, token, row.userId, data, row.createdAt, true)
        }
        await db.delete(webSessions).where(eq(webSessions.id, row.id))
      }
    }
    return new Session(db, options, newToken(), null, { csrf: randomBytes(32).toString('hex') }, utc(), false)
  }

  /** New token, same data, fresh absolute timeout. Call whenever the login state changes. */
  async regenerate(): Promise<void> {
    const old = digest(this.tokenValue)
    this.tokenValue = newToken()
    this.createdAt = utc()
    if (!this.stored) {
      await this.insert()
      return
    }
    await this.db.update(webSessions)
      .set({ id: digest(this.tokenValue), userId: this.userId, data: JSON.stringify(this.data), createdAt: this.createdAt, seenAt: this.createdAt })
      .where(eq(webSessions.id, old))
    this.dirty = false
  }

  async destroy(): Promise<void> {
    if (this.stored) {
      await this.db.delete(webSessions).where(eq(webSessions.id, digest(this.tokenValue)))
    }
    this.stored = false
    this.needed = false
    this.dirty = false
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
    if (!this.stored) {
      if (this.dirty || this.needed) {
        await this.insert()
      }
      return
    }
    if (this.dirty) {
      await this.db.update(webSessions)
        .set({ userId: this.userId, data: JSON.stringify(this.data) })
        .where(eq(webSessions.id, digest(this.tokenValue)))
      this.dirty = false
    }
  }

  /** Writes a new session's row; first removes the sessions whose idle timeout has passed. */
  private async insert(): Promise<void> {
    await this.db.delete(webSessions).where(or(
      lt(webSessions.seenAt, utc(-this.options.idleTimeout)),
      and(isNull(webSessions.userId), lt(webSessions.seenAt, utc(-anonymousIdle(this.options)))),
    ))
    await this.db.insert(webSessions).values({
      id: digest(this.tokenValue), userId: this.userId, data: JSON.stringify(this.data), createdAt: this.createdAt, seenAt: this.createdAt,
    })
    this.stored = true
    this.dirty = false
  }
}

/** Not logged in (a visitor of the login page, a bot, or a login or setup under way). */
function anonymousIdle(options: SessionOptions): number {
  return Math.min(options.idleTimeout, ANONYMOUS_IDLE_SECONDS)
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
