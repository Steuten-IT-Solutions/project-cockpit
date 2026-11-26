import { bigint, char, datetime, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core'

// Tables shared with the PHP cockpit. The schema itself is defined by the SQL files
// in ../migrations; these declarations only describe it for typed queries.
// Every DATETIME holds UTC as 'YYYY-MM-DD HH:MM:SS' (see server/lib/time.ts).

export const users = mysqlTable('users', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  username: varchar('username', { length: 64 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  totpSecretEnc: varchar('totp_secret_enc', { length: 255 }).notNull(),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  lastLoginAt: datetime('last_login_at', { mode: 'string' }),
})

export const recoveryCodes = mysqlTable('recovery_codes', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  userId: int('user_id', { unsigned: true }).notNull(),
  codeHash: char('code_hash', { length: 64 }).notNull(),
  usedAt: datetime('used_at', { mode: 'string' }),
})

export const authAttempts = mysqlTable('auth_attempts', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  scope: varchar('scope', { length: 16 }).notNull(),
  keyHash: char('key_hash', { length: 64 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
})

export const authEvents = mysqlTable('auth_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: int('user_id', { unsigned: true }),
  event: varchar('event', { length: 32 }).notNull(),
  ipHash: char('ip_hash', { length: 64 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
})

export const webSessions = mysqlTable('web_sessions', {
  id: char('id', { length: 64 }).primaryKey(),
  userId: int('user_id', { unsigned: true }),
  data: text('data').notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  seenAt: datetime('seen_at', { mode: 'string' }).notNull(),
})
