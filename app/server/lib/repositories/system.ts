import { desc, eq } from 'drizzle-orm'
import type { CronRun } from '#shared/types/cockpit'
import { authEvents, cronRuns } from '../../database/schema'
import type { Database } from '../db'

// cron_runs and the login history shown on the dashboard.

export class SystemRepository {
  constructor(private readonly db: Database) {}

  async lastCron(): Promise<CronRun | null> {
    const [row] = await this.db.select({
      startedAt: cronRuns.startedAt, finishedAt: cronRuns.finishedAt, phpVersion: cronRuns.phpVersion,
      phpSapi: cronRuns.phpSapi, status: cronRuns.status, message: cronRuns.message,
    }).from(cronRuns).orderBy(desc(cronRuns.id)).limit(1)
    return row ?? null
  }

  /** The user's latest login events, like AuthLog::recent(). */
  async recentEvents(userId: number, limit: number): Promise<{ event: string, createdAt: string }[]> {
    return this.db.select({ event: authEvents.event, createdAt: authEvents.createdAt }).from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(desc(authEvents.id)).limit(Math.max(1, Math.min(limit, 50)))
  }
}
