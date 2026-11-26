import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { database, databasePool } from '../lib/db'
import type { JobContext } from '../lib/jobs/runner'

/**
 * Everything the background jobs need. They run without a request (scheduled task), so
 * this reads the runtime config directly. The migrations folder defaults to ../migrations
 * next to the app folder, where it is in the repository and on the server.
 */
export function jobContext(event?: H3Event): JobContext {
  const runtime = useRuntimeConfig(event)
  return {
    config: cockpitConfig(event),
    db: database(runtime.databaseUrl),
    pool: databasePool(runtime.databaseUrl),
    migrationsDir: runtime.migrationsDir !== '' ? runtime.migrationsDir : resolve(process.cwd(), '../migrations'),
  }
}

/** Reads a key file named in the settings (GitHub App, VAPID). */
export function readKeyFile(path: string): Promise<string> {
  return import('node:fs/promises').then(fs => fs.readFile(path, 'utf8'))
}
