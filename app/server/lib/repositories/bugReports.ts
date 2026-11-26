import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { bugReportCounts, bugReports, reportInstallations } from '../../database/schema'
import type { Database } from '../db'
import { cut } from '../text'
import { utc } from '../time'

// Bug reports in MariaDB (migration 0008), like src/Reports/BugReportRepository.php: the
// parts the background job needs. The receiver (Phase 5) adds the incoming side.

/** Done reports are kept this long (without content) to recognise a report that is sent again. */
export const KEEP_DONE_DAYS = 30
/** Reports without an issue are given up after this long. */
export const KEEP_PENDING_DAYS = 30
export const BUG_REPORT_LOCK = 'cockpit_bug_reports'

export interface PendingReport {
  id: number
  installationId: string
  reportId: string
  kompanie: string
  payload: string
  screenshot: Buffer | null
  screenshotType: string | null
  screenshotUrl: string | null
  attempts: number
}

export class BugReportRepository {
  constructor(private readonly db: Database) {}

  /** Reports without an issue yet, oldest first. */
  async pending(limit: number): Promise<PendingReport[]> {
    return this.db.select({
      id: bugReports.id, installationId: bugReports.installationId, reportId: bugReports.reportId,
      kompanie: bugReports.kompanie, payload: bugReports.payload, screenshot: bugReports.screenshot,
      screenshotType: bugReports.screenshotType, screenshotUrl: bugReports.screenshotUrl, attempts: bugReports.attempts,
    }).from(bugReports).where(isNull(bugReports.doneAt)).orderBy(asc(bugReports.id)).limit(Math.max(1, limit))
  }

  async screenshotCommitted(id: number, url: string): Promise<void> {
    await this.db.update(bugReports).set({ screenshotUrl: url, screenshot: null }).where(eq(bugReports.id, id))
  }

  /** The issue exists: clears payload and screenshot, keeps the row against duplicates. */
  async done(id: number, issueNumber: number, issueUrl: string, now: string): Promise<void> {
    await this.db.update(bugReports)
      .set({ issueNumber, issueUrl, doneAt: now, payload: '{}', screenshot: null, lastError: null })
      .where(eq(bugReports.id, id))
  }

  async failed(id: number, error: string): Promise<void> {
    await this.db.update(bugReports)
      .set({ attempts: sql`${bugReports.attempts} + 1`, lastError: cut(error, 255) })
      .where(eq(bugReports.id, id))
  }

  /** Removes done reports, given-up reports, old counters and secrets of installations that went quiet (UTC). */
  async prune(now: number): Promise<void> {
    const ms = now * 1000
    await this.db.delete(bugReports).where(and(isNotNull(bugReports.doneAt), lt(bugReports.doneAt, utc(-KEEP_DONE_DAYS * 86400, ms))))
    await this.db.delete(bugReports).where(and(isNull(bugReports.doneAt), lt(bugReports.receivedAt, utc(-KEEP_PENDING_DAYS * 86400, ms))))
    // Hour buckets are 'YYYYMMDDHH' in UTC, like gmdate('YmdH').
    const hour = new Date(ms - 2 * 86400 * 1000).toISOString().slice(0, 13).replace(/[-T]/g, '')
    await this.db.delete(bugReportCounts).where(lt(bugReportCounts.hour, hour))
    await this.db.delete(reportInstallations).where(lt(reportInstallations.lastSeen, utc(-365 * 86400, ms)))
  }
}
