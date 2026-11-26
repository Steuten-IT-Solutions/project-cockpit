import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Incoming } from '../reports/bugReport'
import type { FormatOneStore, InstallationStore } from '../status/receiver'
import type { Format2, StatusRow, Usage } from '../status/report'
import type { IncomingReportStore } from '../reports/receiver'

// The receiver's writes, statement for statement as in the PHP cockpit
// (src/Status/StatusRepository.php, InstallationRepository.php, src/Reports/BugReportRepository.php),
// in plain SQL because INSERT IGNORE / ON DUPLICATE KEY and the affected-row counts decide
// the outcome (a parallel first report, a nonce seen before).

async function rows(pool: Pool, statement: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [result] = await pool.query<RowDataPacket[]>(statement, params)
  return result
}

async function run(pool: Pool, statement: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query<ResultSetHeader>(statement, params)
  return result
}

/** Empty objects as '{}', like InstallationRepository::json() (PHP would write [] otherwise). */
function jsonColumn(value: Record<string, unknown>): string {
  return Object.keys(value).length === 0 ? '{}' : JSON.stringify(value)
}

/** The shared hourly counter of format 1 and format 2 reports. */
async function countInHour(pool: Pool, hour: string, dayAgo: string): Promise<number> {
  await run(pool, 'INSERT INTO status_report_hours (hour, received) VALUES (?, 1) ON DUPLICATE KEY UPDATE received = received + 1', [hour])
  await run(pool, 'DELETE FROM status_report_hours WHERE hour < ?', [dayAgo])
  const [row] = await rows(pool, 'SELECT received FROM status_report_hours WHERE hour = ?', [hour])
  return Number(row?.received ?? 0)
}

async function companyKnown(pool: Pool, kompanie: string): Promise<boolean> {
  const [row] = await rows(pool, 'SELECT COUNT(*) AS projects, SUM(LOWER(full_name) = LOWER(?)) AS matching FROM projects', [kompanie])
  return row === undefined || Number(row.projects) === 0 || Number(row.matching) > 0
}

async function claimNonce(pool: Pool, installation: string, nonce: string, now: string): Promise<boolean> {
  const result = await run(pool, 'INSERT IGNORE INTO status_nonces (installation_id, nonce, received_at) VALUES (?, ?, ?)', [installation, nonce, now])
  return result.affectedRows === 1
}

async function findInstallation(pool: Pool, id: string) {
  const [row] = await rows(pool, 'SELECT kompanie, variant, secret_enc FROM installations WHERE id = ?', [id])
  return row === undefined ? null : { kompanie: String(row.kompanie), variant: String(row.variant), secretEnc: String(row.secret_enc) }
}

const FORMAT_ONE_COLUMNS = ['kompanie', 'variant', 'version', 'php', 'db_driver', 'update_ok', 'update_at', 'update_to', 'update_check_ok', 'gallery_ok', 'gallery_at', 'sent_at']

export class FormatOneRepository implements FormatOneStore {
  constructor(private readonly pool: Pool) {}

  countInHour(hour: string, dayAgo: string) {
    return countInHour(this.pool, hour, dayAgo)
  }

  async pruneBefore(cutoff: string) {
    await run(this.pool, 'DELETE FROM status_reports WHERE received_at < ?', [cutoff])
  }

  async exists(kompanie: string, variant: string) {
    return (await rows(this.pool, 'SELECT 1 FROM status_reports WHERE kompanie = ? AND variant = ?', [kompanie, variant])).length > 0
  }

  async count() {
    const [row] = await rows(this.pool, 'SELECT COUNT(*) AS n FROM status_reports')
    return Number(row?.n ?? 0)
  }

  async save(row: StatusRow, receivedAt: string) {
    const values = [row.kompanie, row.variant, row.version, row.php, row.dbDriver, row.updateOk, row.updateAt, row.updateTo,
      row.updateCheckOk, row.galleryOk, row.galleryAt, row.sentAt, receivedAt]
    const updates = [...FORMAT_ONE_COLUMNS.slice(2), 'received_at'].map(c => `${c} = VALUES(${c})`).join(', ')
    await run(this.pool, `INSERT INTO status_reports (${FORMAT_ONE_COLUMNS.join(', ')}, received_at) VALUES (${values.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`, values)
  }
}

export class InstallationWriter implements InstallationStore {
  constructor(private readonly pool: Pool) {}

  find(id: string) {
    return findInstallation(this.pool, id)
  }

  async count() {
    const [row] = await rows(this.pool, 'SELECT COUNT(*) AS n FROM installations')
    return Number(row?.n ?? 0)
  }

  companyKnown(kompanie: string) {
    return companyKnown(this.pool, kompanie)
  }

  countInHour(hour: string, dayAgo: string) {
    return countInHour(this.pool, hour, dayAgo)
  }

  claimNonce(installation: string, nonce: string, now: string) {
    return claimNonce(this.pool, installation, nonce, now)
  }

  async register(report: Format2, secretEnc: string, now: string) {
    const result = await run(this.pool, `INSERT IGNORE INTO installations (id, kompanie, variant, secret_enc, version, php, db_driver, cron_kind, checks, errors, details, features,
      update_check_ok, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      report.installation, report.kompanie, report.variant, secretEnc, report.version, report.php,
      report.dbDriver, report.cronKind, '{}', '{}', '{}', '', report.updateCheckOk, now, now,
    ])
    return result.affectedRows === 1
  }

  async record(report: Format2, now: string) {
    const checks = jsonColumn(report.checks)
    const errors = jsonColumn(report.errors)
    const details = jsonColumn(report.details)
    const heartbeat = report.kind === 'heartbeat'
    await run(this.pool, `UPDATE installations SET kompanie = ?, variant = ?, version = ?, php = ?, db_driver = ?, cron_kind = ?, cron_last = ?, checks = ?, errors = ?, details = ?,
      features = ?, update_ok = ?, update_at = ?, update_to = ?, update_check_ok = ?, gallery_ok = ?, gallery_at = ?,
      maintenance = ?, last_seen = ?${heartbeat ? ', last_heartbeat = ?' : ''} WHERE id = ?`, [
      report.kompanie, report.variant, report.version, report.php, report.dbDriver, report.cronKind, report.cronLast, checks, errors, details,
      report.features.join(','), report.updateOk, report.updateAt, report.updateTo, report.updateCheckOk, report.galleryOk, report.galleryAt,
      report.maintenance, now, ...(heartbeat ? [now, report.installation] : [report.installation]),
    ])
    if (heartbeat) {
      await run(this.pool, 'INSERT INTO status_heartbeats (installation_id, received_at, version, checks, errors, details, cron_kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [report.installation, now, report.version, checks, errors, details, report.cronKind])
    }
    else {
      await run(this.pool, 'INSERT INTO status_events (installation_id, code, detail, version, received_at) VALUES (?, ?, ?, ?, ?)',
        [report.installation, report.event ?? '', report.detail, report.version, now])
    }
    if (heartbeat && report.usage !== null) {
      await this.recordUsage(report.installation, report.usage, now)
    }
  }

  /** Current usage figures at the installation and one row per installation and UTC day (the last heartbeat wins). */
  private async recordUsage(id: string, usage: Usage, now: string) {
    // PHP's json_encode wrote an empty areas list as []; kept so both cockpits read the same.
    const counts = JSON.stringify({ ...usage, areas: Object.keys(usage.areas).length === 0 ? [] : usage.areas })
    await run(this.pool, 'UPDATE installations SET usage_counts = ? WHERE id = ?', [counts, id])
    const day = now.slice(0, 10)
    await run(this.pool, 'DELETE FROM status_usage WHERE installation_id = ? AND day = ?', [id, day])
    await run(this.pool, 'INSERT INTO status_usage (installation_id, day, users, d1, d7, d30, areas) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, day, usage.users, usage.d1, usage.d7, usage.d30, jsonColumn(usage.areas)])
  }
}

export class IncomingReportRepository implements IncomingReportStore {
  constructor(private readonly pool: Pool) {}

  async secretFor(installation: string) {
    const known = await findInstallation(this.pool, installation)
    if (known !== null) return { kompanie: known.kompanie, secretEnc: known.secretEnc }
    const [row] = await rows(this.pool, 'SELECT kompanie, secret_enc FROM report_installations WHERE id = ?', [installation])
    return row === undefined ? null : { kompanie: String(row.kompanie), secretEnc: String(row.secret_enc) }
  }

  async registerSecret(installation: string, kompanie: string, secretEnc: string, now: string) {
    const result = await run(this.pool, 'INSERT IGNORE INTO report_installations (id, kompanie, secret_enc, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)',
      [installation, kompanie, secretEnc, now, now])
    return result.affectedRows === 1
  }

  companyKnown(kompanie: string) {
    return companyKnown(this.pool, kompanie)
  }

  async hit(bucket: string, hour: string) {
    await run(this.pool, 'INSERT INTO bug_report_counts (bucket, hour, received) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE received = received + 1', [bucket, hour])
    const [row] = await rows(this.pool, 'SELECT received FROM bug_report_counts WHERE bucket = ? AND hour = ?', [bucket, hour])
    return Number(row?.received ?? 0)
  }

  claimNonce(installation: string, nonce: string, now: string) {
    return claimNonce(this.pool, installation, nonce, now)
  }

  async exists(installation: string, reportId: string) {
    return (await rows(this.pool, 'SELECT 1 FROM bug_reports WHERE installation_id = ? AND report_id = ?', [installation, reportId])).length > 0
  }

  async store(report: Incoming, now: string) {
    await run(this.pool, `INSERT IGNORE INTO bug_reports (installation_id, report_id, kompanie, payload, screenshot, screenshot_type, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [report.installation, report.reportId, report.kompanie, JSON.stringify(report.fields), report.screenshot, report.screenshotType, now])
    await run(this.pool, 'UPDATE report_installations SET last_seen = ? WHERE id = ?', [now, report.installation])
  }
}
