import { readFile } from 'node:fs/promises'
import { desc, eq, lt, max } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { money } from '#shared/lib/costs'
import { today } from '#shared/lib/erp'
import type { CockpitConfig } from '../config'
import { cronRuns } from '../../database/schema'
import type { Database } from '../db'
import { GitHubClient } from '../github/client'
import { syncGitHub } from '../github/sync'
import { withLock } from '../lock'
import { migrate } from '../migrator'
import { WebPush } from '../push'
import { ReleaseSync } from '../releases/sync'
import { BugReportSync } from '../reports/sync'
import { BillingRepository } from '../repositories/billing'
import { BUG_REPORT_LOCK, BugReportRepository } from '../repositories/bugReports'
import { ProjectRepository } from '../repositories/projects'
import { PushSubscriptionRepository } from '../repositories/push'
import { ReleaseRepository } from '../repositories/releases'
import { AlertRepository, InstallationRepository, StatusRepository } from '../repositories/status'
import { VercelRepository } from '../repositories/vercel'
import { evaluateAlerts, KEEP_DAYS as ALERT_KEEP_DAYS } from '../status/alerts'
import type { Crypto } from '../crypto'
import type { InvoiceEngine } from '../erp/engine'
import { InvoiceRepository } from '../erp/invoices'
import { fetchIncomingMail, fetchSummary } from '../erp/mailbox'
import { SubscriptionRepository } from '../erp/subscriptions'
import { Notifier, sendmail } from '../status/notifier'
import { cut } from '../text'
import { utc, utcSeconds } from '../time'
import { syncBilling } from '../vercel/billing'
import { VercelClient } from '../vercel/client'
import { syncVercel } from '../vercel/sync'

// One run of the background jobs, like src/Jobs/Runner.php: migrations, then every data
// source. Started every 15 minutes by the scheduled task (server/tasks/cockpit/jobs.ts) and
// by the refresh button on the dashboard. It takes the same database lock as the PHP
// cron, so the two can never run at the same time.

const LOCK = 'cockpit_cron'
/** Status reports (format 1) are kept this long, as the receiver does (Receiver::KEEP_DAYS). */
const REPORT_KEEP_DAYS = 60
/** Twice the receiver's replay window: nonces older than that cannot be replayed anyway. */
const NONCE_KEEP_SECONDS = 2 * 600
const USAGE_KEEP_DAYS = 400

export interface JobContext {
  config: CockpitConfig
  db: Database
  pool: Pool
  migrationsDir: string
  /** Reads a key file; tests replace it. */
  readKey?: (path: string) => Promise<string>
  /** For the mailbox of incoming invoices; without it that step is skipped. */
  erp?: { engine: InvoiceEngine, crypto: Crypto }
}

export interface JobResult { status: 'ok' | 'warn', message: string | null }

/** Seconds since the last run started, or null if there was none. */
export async function secondsSinceLastRun(db: Database, now: number): Promise<number | null> {
  const [row] = await db.select({ last: max(cronRuns.startedAt) }).from(cronRuns)
  return row?.last ? Math.max(0, now - utcSeconds(row.last)) : null
}

/**
 * Runs all jobs; null if another run (Node or PHP) holds the lock.
 * @param trigger shown with the run's message, e.g. "Manuell gestartet"
 */
export function runJobs(ctx: JobContext, trigger: string | null = null): Promise<JobResult | null> {
  return withLock(ctx.pool, LOCK, () => execute(ctx, trigger))
}

/**
 * Only the migrations, under the same lock as the jobs (server start). null if a job
 * run holds the lock: that run migrates first anyway.
 */
export function migrateNow(ctx: Pick<JobContext, 'pool' | 'migrationsDir'>): Promise<string[] | null> {
  return withLock(ctx.pool, LOCK, () => migrate(ctx.pool, ctx.migrationsDir))
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

async function execute(ctx: JobContext, trigger: string | null): Promise<JobResult> {
  const { config, db, pool } = ctx
  const readKey = ctx.readKey ?? (path => readFile(path, 'utf8'))
  const applied = await migrate(pool, ctx.migrationsDir)

  // php_version and php_sapi hold the runtime, so the dashboard shows what ran the jobs.
  const [inserted] = await db.insert(cronRuns).values({
    startedAt: utc(), phpVersion: `node ${process.versions.node}`, phpSapi: 'node', status: 'running',
  }).$returningId()
  const runId = inserted!.id

  let status: JobResult['status'] = 'ok'
  // Shown on the dashboard, so in German.
  const messages: string[] = []
  if (trigger !== null) messages.push(trigger)
  if (applied.length > 0) messages.push(`Migrationen angewendet: ${applied.join(', ')}`)
  const fail = (text: string) => {
    status = 'warn'
    messages.push(text)
  }

  // Each source has its own error handling, so one failing source does not stop the others.
  let github: GitHubClient | null = null
  if (config.github !== null) {
    try {
      let key: string
      try {
        key = await readKey(config.github.privateKeyFile)
      }
      catch {
        throw new Error('Schlüsseldatei der GitHub App nicht lesbar.')
      }
      github = new GitHubClient(config.github.clientId, key, config.github.apiBase)
      const result = await syncGitHub(github, new ProjectRepository(db), config.github.accounts, nowSeconds(), utc())
      messages.push(`GitHub: ${result.repos} Repos aktualisiert`)
      if (result.errors.length > 0) fail(`${result.errors.length} Fehler, z. B. ${result.errors[0]}`)
    }
    catch (e) {
      fail(`GitHub: ${(e as Error).message}`)
    }
  }

  // Releases of the company app template; the webhook records them at once, this catches lost deliveries.
  if (config.releases !== null) {
    try {
      // The settings check makes releases require the github section; null here means its key was unreadable.
      if (github === null) throw new Error('Schlüsseldatei der GitHub App nicht lesbar.')
      const result = await new ReleaseSync(github, new ReleaseRepository(db), config.releases.repo).run(nowSeconds())
      messages.push(`Releases: ${result.runs} Läufe geprüft`)
    }
    catch (e) {
      fail(`Releases: ${(e as Error).message}`)
    }
  }

  if (config.vercel !== null) {
    const vercel = config.vercel
    const client = new VercelClient(vercel.token, vercel.teamId, vercel.apiBase)
    try {
      const result = await syncVercel(client, new VercelRepository(db), utc())
      messages.push(`Vercel: ${result.projects} Projekte`)
      if (result.errors.length > 0) fail(`${result.errors.length} Fehler, z. B. ${result.errors[0]}`)
    }
    catch (e) {
      fail(`Vercel: ${(e as Error).message}`)
    }
    if (vercel.billing) {
      const billing = new BillingRepository(db)
      try {
        const totals = await syncBilling(client, billing, nowSeconds(), utc())
        const amounts = Object.entries(totals).map(([currency, amount]) => money(amount * 100, currency))
        messages.push(`Vercel-Kosten seit Monatsbeginn: ${amounts.length === 0 ? 'keine' : amounts.join(', ')}`)
      }
      catch (e) {
        fail(`Vercel-Kosten: ${(e as Error).message}`)
        await billing.fail((e as Error).message, utc())
      }
    }
  }

  // Status reports format 2 and 3: evaluate, alert, prune (history 90 days, daily usage figures 400 days).
  if (config.statusReports !== null) {
    try {
      const installations = new InstallationRepository(db)
      await installations.prune(utc(-ALERT_KEEP_DAYS * 86400), utc(-NONCE_KEEP_SECONDS), utc(-USAGE_KEEP_DAYS * 86400))
      const [notifier, pushError] = await buildNotifier(ctx, readKey)
      const result = await evaluateAlerts(installations, new AlertRepository(db), notifier, nowSeconds())
      if (pushError !== null) fail(`Push: ${pushError}`)
      if (result.opened > 0 || result.resolved > 0) {
        messages.push(`Warnungen: ${result.opened} neu, ${result.resolved} behoben`)
      }
    }
    catch (e) {
      fail('Warnungen: Auswertung fehlgeschlagen (Details im Fehlerprotokoll).')
      console.error('[cockpit alerts]', e)
    }
  }

  // Bug reports of the company apps: issues in the private reports repository.
  if (config.bugReports !== null && config.statusReports !== null) {
    try {
      const reports = new BugReportRepository(db)
      await reports.prune(nowSeconds())
      const sync = await bugReportSync(ctx, reports, readKey)
      if (sync !== null) {
        const result = await sync.run(nowSeconds())
        if (result.created > 0) messages.push(`Fehlermeldungen: ${result.created} als Issue angelegt`)
        if (result.errors.length > 0) fail(`Fehlermeldungen: ${result.failed} nicht angelegt, z. B. ${result.errors[0]}`)
      }
    }
    catch (e) {
      fail(`Fehlermeldungen: ${(e as Error).message}`)
    }
  }

  // Recurring invoices that are due become drafts; finalizing and sending stay manual.
  try {
    const created = await new SubscriptionRepository(pool).runDue(new InvoiceRepository(pool), today(config.timezone), utc())
    if (created > 0) messages.push(`Wiederkehrende Rechnungen: ${created} ${created === 1 ? 'Entwurf' : 'Entwürfe'} angelegt`)
  }
  catch (e) {
    fail(`Wiederkehrende Rechnungen: ${(e as Error).message}`)
  }

  // Incoming invoices by e-mail (server/lib/erp/mailbox.ts), if a mailbox is set up.
  if (ctx.erp !== undefined) {
    try {
      const result = await fetchIncomingMail(pool, ctx.erp.crypto, ctx.erp.engine, utc())
      if (result !== null && result.messages > 0) messages.push(fetchSummary(result))
    }
    catch (e) {
      fail(`Postfach: ${(e as Error).message}`)
    }
  }

  const message = messages.length === 0 ? null : cut(messages.join(' · '), 255)
  await db.update(cronRuns).set({ finishedAt: utc(), status, message }).where(eq(cronRuns.id, runId))

  // Keep 30 days of history.
  await db.delete(cronRuns).where(lt(cronRuns.startedAt, utc(-30 * 86400)))
  // The receiver prunes too, but only when a report arrives.
  await new StatusRepository(db).pruneBefore(utc(-REPORT_KEEP_DAYS * 86400))

  return { status, message }
}

/** E-mail and push as configured; null if neither is. A broken push key does not stop the e-mails. */
async function buildNotifier(ctx: JobContext, readKey: (path: string) => Promise<string>): Promise<[Notifier | null, string | null]> {
  const { config } = ctx
  let push: WebPush | null = null
  let pushError: string | null = null
  if (config.push !== null) {
    let pem: string | null = null
    try {
      pem = await readKey(config.push.privateKeyFile)
    }
    catch {
      pushError = 'VAPID-Schlüssel nicht lesbar.'
    }
    if (pem !== null) {
      try {
        push = new WebPush(pem, config.push.subject)
      }
      catch {
        pushError = 'VAPID-Schlüssel ungültig (EC P-256 im PEM-Format erwartet).'
      }
    }
  }
  if (push === null && config.alerts === null) return [null, pushError]
  return [new Notifier(
    config.baseUrl,
    config.alerts === null ? null : { to: config.alerts.email, from: config.alerts.from },
    push,
    push === null ? null : new PushSubscriptionRepository(ctx.db),
    sendmail(config.mail.sendmail),
  ), pushError]
}

/** The app of the bug_reports section if it names one, else the app of the github section. */
async function bugReportSync(ctx: JobContext, store: BugReportRepository, readKey: (path: string) => Promise<string>): Promise<BugReportSync | null> {
  const { config } = ctx
  const reports = config.bugReports
  if (reports === null) return null
  const clientId = reports.clientId ?? config.github?.clientId ?? null
  const keyFile = reports.privateKeyFile ?? config.github?.privateKeyFile ?? null
  if (clientId === null || keyFile === null) return null
  let key: string
  try {
    key = await readKey(keyFile)
  }
  catch {
    throw new Error('Schlüsseldatei der GitHub App für Fehlermeldungen nicht lesbar.')
  }
  const client = new GitHubClient(clientId, key, config.github?.apiBase ?? 'https://api.github.com')
  return new BugReportSync(client, store, job => withLock(ctx.pool, BUG_REPORT_LOCK, job), reports.repo, reports.labelPrefix, config.timezone)
}

/** The last runs, newest first (for tests and the dashboard). */
export async function recentRuns(db: Database, limit = 5) {
  return db.select().from(cronRuns).orderBy(desc(cronRuns.id)).limit(limit)
}
