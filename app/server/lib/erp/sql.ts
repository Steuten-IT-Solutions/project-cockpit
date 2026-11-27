import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise'

// Small helpers for the ERP's SQL. The ERP uses plain SQL with placeholders (never
// values pasted into the text) instead of drizzle, because finalizing needs row locks
// (SELECT ... FOR UPDATE) inside one transaction, which reads clearer as SQL.

export type Sql = Pool | PoolConnection

export async function rows<T>(db: Sql, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await db.query(sql, params)
  return result as T[]
}

export async function one<T>(db: Sql, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null
}

export async function exec(db: Sql, sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await db.query(sql, params)
  return result as ResultSetHeader
}

/** Runs `work` in one transaction on one connection: all of it is stored, or nothing. */
export async function transaction<T>(pool: Pool, work: (db: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  }
  catch (e) {
    await connection.rollback()
    throw e
  }
  finally {
    connection.release()
  }
}

/** SUM() of a BIGINT comes back as a decimal string; this makes it a number again. */
export const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value))

/** Lines as stored (invoice_lines, subscription_lines, sales_lines) in the shape of `Line`. */
export const LINE_COLUMNS = 'name, description, quantity_milli AS quantityMilli, unit, unit_price_cents AS unitPriceCents, vat_rate AS vatRate, discount_bp AS discountBp'
