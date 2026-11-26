import { and, count, eq, gte, isNull, lt, or } from 'drizzle-orm'
import type { Crypto } from './crypto'
import type { Database } from './db'
import { authAttempts, authEvents, recoveryCodes, users } from '../database/schema'
import { utc } from './time'

// The same rules as the PHP cockpit (src/Auth/*), working on the same tables.

export type User = typeof users.$inferSelect

export const THROTTLE_WINDOW_SECONDS = 15 * 60
export const MAX_FAILURES_PER_ACCOUNT = 5
export const MAX_FAILURES_PER_IP = 20

export class UserRepository {
  constructor(private readonly db: Database) {}

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.username, username)).limit(1)
    return rows[0] ?? null
  }

  async findById(id: number): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return rows[0] ?? null
  }

  /** Stores the step of an accepted code; false if it (or a later one) was already used. */
  async claimTotpStep(userId: number, step: number): Promise<boolean> {
    const [result] = await this.db.update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    return result.affectedRows === 1
  }

  /** Marks a recovery code as used; false if it is unknown or already used. */
  async useRecoveryCode(userId: number, codeHash: string): Promise<boolean> {
    const [result] = await this.db.update(recoveryCodes)
      .set({ usedAt: utc() })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
    return result.affectedRows === 1
  }

  async remainingRecoveryCodes(userId: number): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    return row?.n ?? 0
  }

  async updatePasswordHash(userId: number, hash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId))
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users)
    return row?.n ?? 0
  }

  /** The first account with its recovery codes, in one transaction. */
  async create(username: string, passwordHash: string, totpSecretEnc: string, totpStep: number, recoveryCodeHashes: string[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ username, passwordHash, totpSecretEnc, totpLastStep: totpStep, createdAt: utc() }).$returningId()
      for (const codeHash of recoveryCodeHashes) {
        await tx.insert(recoveryCodes).values({ userId: created!.id, codeHash })
      }
      return created!.id
    })
  }

  async touchLogin(userId: number): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: utc() }).where(eq(users.id, userId))
  }
}

/**
 * Failed attempts per account and per IP within 15 minutes. Usernames and IPs are
 * stored only as keyed hashes.
 */
export class Throttle {
  constructor(private readonly db: Database, private readonly crypto: Crypto) {}

  async isBlocked(username: string, ip: string): Promise<boolean> {
    return (await this.failures('account', username)) >= MAX_FAILURES_PER_ACCOUNT
      || (await this.failures('ip', ip)) >= MAX_FAILURES_PER_IP
  }

  async recordFailure(username: string, ip: string): Promise<void> {
    const now = utc()
    await this.db.insert(authAttempts).values([
      { scope: 'account', keyHash: this.key('account', username), createdAt: now },
      { scope: 'ip', keyHash: this.key('ip', ip), createdAt: now },
    ])
    // Keep the table small; a day is far longer than any window.
    await this.db.delete(authAttempts).where(lt(authAttempts.createdAt, utc(-86400)))
  }

  async clearAccount(username: string): Promise<void> {
    await this.db.delete(authAttempts)
      .where(and(eq(authAttempts.scope, 'account'), eq(authAttempts.keyHash, this.key('account', username))))
  }

  private async failures(scope: 'account' | 'ip', value: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(authAttempts).where(and(
      eq(authAttempts.scope, scope),
      eq(authAttempts.keyHash, this.key(scope, value)),
      gte(authAttempts.createdAt, utc(-THROTTLE_WINDOW_SECONDS)),
    ))
    return row?.n ?? 0
  }

  private key(scope: string, value: string): string {
    return this.crypto.hash(`throttle-${scope}`, value.toLowerCase())
  }
}

/** Security log: logins, failures, logouts. The IP is stored as a keyed hash only. */
export class AuthLog {
  constructor(private readonly db: Database, private readonly crypto: Crypto) {}

  async record(event: string, userId: number | null, ip: string): Promise<void> {
    await this.db.insert(authEvents).values({ userId, event, ipHash: this.crypto.hash('ip', ip), createdAt: utc() })
  }
}
