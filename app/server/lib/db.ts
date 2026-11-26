import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql, { type Pool } from 'mysql2/promise'
import * as schema from '../database/schema'

export type Database = MySql2Database<typeof schema>

let instance: { url: string, db: Database, pool: Pool } | undefined

function open(url: string) {
  if (instance?.url !== url) {
    if (url === '') {
      throw new Error('NUXT_DATABASE_URL is not set.')
    }
    const pool = mysql.createPool({ uri: url, dateStrings: true, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 5 })
    instance = { url, db: drizzle(pool, { schema, mode: 'default' }), pool }
  }
  return instance
}

/**
 * One connection pool per process. DATETIME values are read and written as plain
 * strings in UTC, never converted by the driver.
 */
export function database(url: string): Database {
  return open(url).db
}

/** The raw pool of the same connection, for migrations and statements drizzle cannot express. */
export function databasePool(url: string): Pool {
  return open(url).pool
}
