import type { Pool } from 'mysql2/promise'

// A named MariaDB lock (GET_LOCK), shared with the PHP cockpit so the two never run the
// same job at once. Such a lock belongs to one database connection, so the whole job runs
// while that connection is held out of the pool, and the lock is released on it again.

/** Runs `job` under the lock; null without running it if another process holds the lock. */
export async function withLock<T>(pool: Pool, name: string, job: () => Promise<T>): Promise<T | null> {
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 0) AS got', [name])
    if (Number((rows as { got: unknown }[])[0]?.got) !== 1) {
      return null
    }
    try {
      return await job()
    }
    finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [name])
    }
  }
  finally {
    connection.release()
  }
}
