import { and, asc, desc, eq, gte, isNull, or } from 'drizzle-orm'
import type { Alert, Installation, StatusReport } from '#shared/types/cockpit'
import { alerts, installations, statusEvents, statusHeartbeats, statusReports, statusUsage } from '../../database/schema'
import type { Database } from '../db'

// Reading status reports and alerts, like src/Status/StatusRepository.php,
// InstallationRepository.php and AlertRepository.php. The receiver and the jobs
// add their writes in server/lib/status/.

export class StatusRepository {
  constructor(private readonly db: Database) {}

  /** Format 1 reports. */
  async all(): Promise<StatusReport[]> {
    return this.db.select().from(statusReports).orderBy(asc(statusReports.kompanie), asc(statusReports.variant))
  }
}

/** Format 1 reports by the GitHub repository of their company (kompanie is "owner/name"). */
export function reportsByRepository(reports: StatusReport[], repos: { id: number, fullName: string }[]): Record<number, StatusReport[]> {
  const byName = new Map(repos.map(r => [r.fullName.toLowerCase(), r.id]))
  const map: Record<number, StatusReport[]> = {}
  for (const report of reports) {
    const id = byName.get(report.kompanie.toLowerCase())
    if (id !== undefined) {
      (map[id] ??= []).push(report)
    }
  }
  return map
}

export function decodeJson<T>(json: string | null | undefined, fallback: T): T {
  if (typeof json !== 'string' || json === '') return fallback
  try {
    const value: unknown = JSON.parse(json)
    // PHP's json_decode(..., true) gives an array for {} and []; both mean "nothing" here.
    return value !== null && typeof value === 'object' ? (Array.isArray(value) && value.length === 0 ? fallback : value as T) : fallback
  }
  catch {
    return fallback
  }
}

export function hydrateInstallation(row: typeof installations.$inferSelect): Installation {
  return {
    id: row.id,
    kompanie: row.kompanie,
    variant: row.variant,
    version: row.version,
    php: row.php,
    dbDriver: row.dbDriver,
    cronKind: row.cronKind,
    cronLast: row.cronLast,
    checks: decodeJson(row.checks, {}),
    errors: decodeJson(row.errors, {}),
    details: decodeJson(row.details, {}),
    features: row.features === '' ? [] : row.features.split(','),
    updateOk: row.updateOk,
    updateAt: row.updateAt,
    updateTo: row.updateTo,
    updateCheckOk: row.updateCheckOk,
    galleryOk: row.galleryOk,
    galleryAt: row.galleryAt,
    maintenance: row.maintenance,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    lastHeartbeat: row.lastHeartbeat,
  }
}

export interface Usage { users: number, d1: number, d7: number, d30: number, areas: Record<string, number> }
export interface UsageDay { day: string, users: number, d1: number, d7: number, d30: number }
export interface HistoryEntry {
  type: 'heartbeat' | 'event'
  receivedAt: string
  version: string
  code: string | null
  detail: string | null
  checks: Record<string, string>
  errors: Record<string, number>
  details: Record<string, Record<string, number>>
}

export class InstallationRepository {
  constructor(private readonly db: Database) {}

  async all(): Promise<Installation[]> {
    const rows = await this.db.select().from(installations).orderBy(asc(installations.kompanie), asc(installations.variant), asc(installations.firstSeen))
    return rows.map(hydrateInstallation)
  }

  async get(id: string): Promise<Installation | null> {
    const [row] = await this.db.select().from(installations).where(eq(installations.id, id)).limit(1)
    return row === undefined ? null : hydrateInstallation(row)
  }

  /** The latest usage figures, null if the installation never sent any. */
  async usage(id: string): Promise<Usage | null> {
    const [row] = await this.db.select({ u: installations.usageCounts }).from(installations).where(eq(installations.id, id)).limit(1)
    const value = decodeJson<Record<string, unknown> | null>(row?.u, null)
    if (value === null || typeof value.areas !== 'object' || value.areas === null) return null
    const n = (k: string) => Math.trunc(Number(value[k] ?? 0)) || 0
    return { users: n('users'), d1: n('d1'), d7: n('d7'), d30: n('d30'), areas: value.areas as Record<string, number> }
  }

  /** Daily usage figures from the given UTC day (YYYY-MM-DD), oldest first. */
  async usageDays(id: string, fromDay: string): Promise<UsageDay[]> {
    const rows = await this.db.select({ day: statusUsage.day, users: statusUsage.users, d1: statusUsage.d1, d7: statusUsage.d7, d30: statusUsage.d30 })
      .from(statusUsage).where(and(eq(statusUsage.installationId, id), gte(statusUsage.day, fromDay))).orderBy(asc(statusUsage.day))
    return rows.map(r => ({ ...r, day: r.day.slice(0, 10) }))
  }

  /** Heartbeats and events since the cutoff, newest first. */
  async history(id: string, cutoff: string, limit: number): Promise<HistoryEntry[]> {
    const beats = await this.db.select().from(statusHeartbeats)
      .where(and(eq(statusHeartbeats.installationId, id), gte(statusHeartbeats.receivedAt, cutoff)))
      .orderBy(desc(statusHeartbeats.receivedAt)).limit(limit)
    const events = await this.db.select().from(statusEvents)
      .where(and(eq(statusEvents.installationId, id), gte(statusEvents.receivedAt, cutoff)))
      .orderBy(desc(statusEvents.receivedAt)).limit(limit)
    const out: HistoryEntry[] = [
      ...beats.map(r => ({
        type: 'heartbeat' as const, receivedAt: r.receivedAt, version: r.version, code: null, detail: null,
        checks: decodeJson(r.checks, {}), errors: decodeJson(r.errors, {}), details: decodeJson(r.details, {}),
      })),
      ...events.map(r => ({
        type: 'event' as const, receivedAt: r.receivedAt, version: r.version, code: r.code, detail: r.detail,
        checks: {}, errors: {}, details: {},
      })),
    ]
    // Stable sort, newest first, heartbeats before events at the same second like PHP's usort here.
    out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))
    return out.slice(0, limit)
  }
}

export class AlertRepository {
  constructor(private readonly db: Database) {}

  async open(): Promise<Alert[]> {
    return this.db.select().from(alerts).where(isNull(alerts.resolvedAt)).orderBy(desc(alerts.openedAt), desc(alerts.id))
  }

  /** Open alerts and those resolved since the cutoff, newest first. */
  async recent(cutoff: string, limit: number): Promise<Alert[]> {
    return this.db.select().from(alerts).where(or(isNull(alerts.resolvedAt), gte(alerts.resolvedAt, cutoff)))
      .orderBy(desc(alerts.openedAt), desc(alerts.id)).limit(limit)
  }

  async forInstallation(id: string, limit: number): Promise<Alert[]> {
    return this.db.select().from(alerts).where(eq(alerts.installationId, id))
      .orderBy(desc(alerts.openedAt), desc(alerts.id)).limit(limit)
  }
}

/** Open alerts by installation id; alerts without an installation (release alerts) are left out. */
export function alertsByInstallation(list: Alert[]): Record<string, Alert[]> {
  const map: Record<string, Alert[]> = {}
  for (const a of list) {
    if (a.installationId !== null) {
      (map[a.installationId] ??= []).push(a)
    }
  }
  return map
}
