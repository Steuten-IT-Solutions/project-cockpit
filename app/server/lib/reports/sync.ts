import type { GitHubClient } from '../github/client'
import { reason } from '../github/client'
import type { BugReportRepository, PendingReport } from '../repositories/bugReports'
import { cut, isRecord } from '../text'
import { utc } from '../time'
import { body, type Fields, label, title, TYPES } from './bugReport'

// Turns stored bug reports into issues of the private reports repository (cron, and right
// after a report arrived), like src/Reports/BugReportSync.php.
//
// GitHub's REST API cannot attach files to issues, so a screenshot is committed to the same
// private repository (screenshots/YYYY/MM/<report id>.<ext>) and shown in the issue from
// there: only people with access to the repository can open it. The installation token is
// limited to that repository with issues and contents write.
//
// A failure keeps the report for the next run; a network error or 5xx stops the run.

const LABEL_COLOR = 'd93f0b'

/** What the sync needs from the database; tests use an in-memory copy. */
export type BugReportStore = Pick<BugReportRepository, 'pending' | 'screenshotCommitted' | 'done' | 'failed'>
/** Runs the job under the bug report lock; null if another run holds it. */
export type Lock = <T>(job: () => Promise<T>) => Promise<T | null>

/** An error with GitHub's HTTP status (0: no answer), shown in the cron status (German). */
export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function error(what: string, status: number, response: unknown): GitHubError {
  return new GitHubError(`${what}: GitHub antwortete ${status}${reason(response)}`, status)
}

/** The stored fields of a report; tolerant, since the row was validated when it arrived. */
export function storedFields(payload: string): Fields {
  let f: unknown
  try {
    f = JSON.parse(payload)
  }
  catch {
    f = null
  }
  const data = isRecord(f) ? f : {}
  const opt = (k: string): string | null => typeof data[k] === 'string' ? data[k] : null
  const str = (k: string): string => opt(k) ?? ''
  const created = data.created
  return {
    description: str('description') === '' ? '(ohne Beschreibung)' : str('description'),
    expected: str('expected'),
    page: str('page'),
    version: str('version'),
    variant: str('variant'),
    userAgent: str('userAgent'),
    role: str('role'),
    name: opt('name'),
    lastError: opt('lastError'),
    created: typeof created === 'number' && Number.isInteger(created) ? created : 0,
  }
}

export class BugReportSync {
  /** Labels known to exist in this run. */
  private labels = new Set<string>()

  constructor(
    private readonly client: GitHubClient,
    private readonly store: BugReportStore,
    private readonly lock: Lock,
    private readonly repo: string,
    private readonly labelPrefix: string,
    private readonly timezone: string,
  ) {}

  async run(now: number, limit = 20): Promise<{ created: number, failed: number, errors: string[] }> {
    const result = await this.lock(() => this.runLocked(now, limit))
    return result ?? { created: 0, failed: 0, errors: [] }
  }

  private async runLocked(now: number, limit: number) {
    const pending = await this.store.pending(limit)
    if (pending.length === 0) return { created: 0, failed: 0, errors: [] }
    const token = await this.token(now)
    let created = 0
    let failed = 0
    const errors: string[] = []
    for (const report of pending) {
      try {
        await this.createIssue(report, token, now)
        created++
      }
      catch (e) {
        const message = (e as Error).message
        failed++
        errors.push(message)
        await this.store.failed(report.id, message)
        const status = e instanceof GitHubError ? e.status : 0
        if (status >= 500 || status === 0) break // GitHub not reachable: try the rest next time
      }
    }
    return { created, failed, errors }
  }

  /** Installation token of the reports repository's owner, limited to that repository. */
  private async token(now: number): Promise<string> {
    const [owner, name] = this.repo.split('/', 2) as [string, string]
    for (const installation of await this.client.installations(now)) {
      if (installation.account.toLowerCase() === owner.toLowerCase()) {
        return this.client.installationToken(installation.id, now, [name], { issues: 'write', contents: 'write', metadata: 'read' })
      }
    }
    throw new Error(`Die GitHub App ist nicht bei ${owner} installiert.`)
  }

  private base(): string {
    const [owner, name] = this.repo.split('/', 2) as [string, string]
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  }

  private async createIssue(report: PendingReport, token: string, now: number): Promise<void> {
    const fields = storedFields(report.payload)
    const base = this.base()
    const name = label(this.labelPrefix, report.kompanie)
    await this.ensureLabel(base, name, report.kompanie, token)

    let screenshotUrl = report.screenshotUrl
    if (screenshotUrl === null && report.screenshot !== null) {
      screenshotUrl = await this.commitScreenshot(base, report, token, now)
      await this.store.screenshotCommitted(report.id, screenshotUrl)
    }

    const [status, response] = await this.client.send('POST', `${base}/issues`, token, {
      title: title(fields.description),
      body: body(fields, report.kompanie, report.installationId, report.reportId, screenshotUrl, this.timezone),
      labels: [name],
    })
    const number = isRecord(response) ? response.number : null
    const url = isRecord(response) ? response.html_url : null
    if (status !== 201 || typeof number !== 'number' || !Number.isInteger(number) || typeof url !== 'string') {
      throw error('Issue', status, response)
    }
    await this.store.done(report.id, number, url, utc(0, now * 1000))
  }

  private async ensureLabel(base: string, name: string, kompanie: string, token: string): Promise<void> {
    if (this.labels.has(name)) return
    let [status, response] = await this.client.get(`${base}/labels/${encodeURIComponent(name)}`, token)
    if (status === 404) {
      ;[status, response] = await this.client.send('POST', `${base}/labels`, token, {
        name,
        color: LABEL_COLOR,
        description: cut(`Fehlermeldungen aus der App ${kompanie}`, 100),
      })
      // 422: created by a parallel run in the meantime
      if (status !== 201 && status !== 422) throw error('Label', status, response)
    }
    else if (status !== 200) {
      throw error('Label', status, response)
    }
    this.labels.add(name)
  }

  /** Returns the address of the file on GitHub (html_url). */
  private async commitScreenshot(base: string, report: PendingReport, token: string, now: number): Promise<string> {
    const ext = TYPES[report.screenshotType ?? ''] ?? 'png'
    const month = new Date(now * 1000).toISOString().slice(0, 7).replace('-', '/')
    const path = `screenshots/${month}/${report.reportId}.${ext}`
    let [status, response] = await this.client.send('PUT', `${base}/contents/${path}`, token, {
      message: `Add screenshot of bug report ${report.reportId}`,
      content: report.screenshot!.toString('base64'),
    })
    let url: unknown
    if (status === 422) {
      // Committed by an earlier, interrupted attempt: use the existing file.
      ;[status, response] = await this.client.get(`${base}/contents/${path}`, token)
      url = isRecord(response) ? response.html_url : null
    }
    else {
      url = isRecord(response) && isRecord(response.content) ? response.content.html_url : null
    }
    if ((status !== 200 && status !== 201) || typeof url !== 'string' || !url.startsWith('https://')) {
      throw error('Bildschirmfoto', status, response)
    }
    return url
  }
}
