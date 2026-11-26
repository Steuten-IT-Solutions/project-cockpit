import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from '../database/schema'

export type Database = MySql2Database<typeof schema>

let instance: { url: string, db: Database } | undefined

/**
 * One connection pool per process. DATETIME values are read and written as plain
 * strings in UTC, never converted by the driver.
 */
export function database(url: string): Database {
  if (instance?.url !== url) {
    if (url === '') {
      throw new Error('NUXT_DATABASE_URL is not set.')
    }
    const pool = mysql.createPool({ uri: url, dateStrings: true, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 5 })
    instance = { url, db: drizzle(pool, { schema, mode: 'default' }) }
  }
  return instance.db
}
