import type { H3Event } from 'h3'
import { migrate } from '../lib/migrator'
import { hashEquals } from '../lib/status/receiver'

/**
 * The setup exists only while a setup token is configured and no user exists. In every
 * other case it answers exactly like an unknown URL. Applies the migrations first, so a
 * fresh database gets its tables (as the PHP setup page did).
 */
export async function requireSetup(event: H3Event, token: unknown): Promise<void> {
  const configured = cockpitConfig(event).setupToken
  if (configured === '' || typeof token !== 'string' || !hashEquals(configured, token)) {
    throw createError({ statusCode: 404, statusMessage: 'Diese Seite gibt es nicht.' })
  }
  await migrate(useCockpit(event).pool, jobContext(event).migrationsDir)
  if (await useCockpit(event).users.count() !== 0) {
    throw createError({ statusCode: 404, statusMessage: 'Diese Seite gibt es nicht.' })
  }
}
