import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'mysql2/promise'
import { utc } from './time'

// Applies ../migrations/NNNN_name.sql in order, each exactly once, exactly like the
// PHP cockpit (src/Database/Migrator.php): same table, same version names, same
// statement splitting. Either side can therefore run a migration and the other one
// sees it as done. MariaDB commits DDL implicitly, so there is no transaction.

/** Splits a migration into statements on semicolons at the end of a line. */
export function statements(sql: string): string[] {
  const withoutComments = sql.replace(/^\s*--.*$/gm, '')
  return withoutComments.split(/;\s*$/m).map(s => s.trim()).filter(s => s !== '')
}

/** Migration files by version (file name without .sql), sorted. */
export function migrationFiles(directory: string): Map<string, string> {
  const files = readdirSync(directory).filter(f => f.endsWith('.sql')).sort()
  return new Map(files.map(f => [f.slice(0, -4), join(directory, f)]))
}

export async function migrate(pool: Pool, directory: string): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
  )`)
  const [rows] = await pool.query('SELECT version FROM schema_migrations')
  const applied = new Set((rows as { version: string }[]).map(r => r.version))
  const done: string[] = []
  for (const [version, file] of migrationFiles(directory)) {
    if (applied.has(version)) {
      continue
    }
    for (const statement of statements(readFileSync(file, 'utf8'))) {
      await pool.query(statement)
    }
    await pool.execute('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, utc()])
    done.push(version)
  }
  return done
}

export async function currentVersion(pool: Pool): Promise<string | null> {
  try {
    const [rows] = await pool.query('SELECT MAX(version) AS v FROM schema_migrations')
    return (rows as { v: string | null }[])[0]?.v ?? null
  }
  catch {
    return null
  }
}
