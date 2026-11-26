import type { H3Event } from 'h3'
import { GitHubClient } from '../../lib/github/client'
import { withLock } from '../../lib/lock'
import { GitHubWebhook, MAX_BODY as WEBHOOK_MAX_BODY } from '../../lib/releases/webhook'
import { ReleaseSync } from '../../lib/releases/sync'
import { BugReportReceiver, MAX_BODY as REPORT_MAX_BODY } from '../../lib/reports/receiver'
import { BugReportSync } from '../../lib/reports/sync'
import { BUG_REPORT_LOCK, BugReportRepository } from '../../lib/repositories/bugReports'
import { FormatOneRepository, IncomingReportRepository, InstallationWriter } from '../../lib/repositories/receiver'
import { ReleaseRepository } from '../../lib/repositories/releases'
import { type Answer, json, MAX_BODY as STATUS_MAX_BODY, Receiver } from '../../lib/status/receiver'

// The status subdomain (receiver/index.php in the PHP cockpit). Apache forwards
// https://status.steuten-it-solutions.de/<path> to /_receiver/<path> here:
// - POST /         status reports of the company apps (formats 1–3)
// - POST /reports  bug reports (with the bug_reports section)
// - POST /github   the GitHub App's webhook (with releases.webhook_secret)
// Everything else answers 404. No sessions, no pages: JSON only.

/** Like receiver/index.php: nothing may embed, sniff or cache these answers. */
const HEADERS: Record<string, string> = {
  'Content-Security-Policy': 'default-src \'none\'; frame-ancestors \'none\'',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Type': 'application/json; charset=utf-8',
}

/**
 * The body, but at most limit + 1 bytes: one byte more than allowed, so an oversized
 * request is recognised without keeping all of it. The rest is read and dropped.
 */
async function readCapped(event: H3Event, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = chunk as Buffer
    if (size <= limit) chunks.push(buffer.subarray(0, limit + 1 - size))
    size += buffer.length
  }
  return Buffer.concat(chunks)
}

/** Work after the answer, so the sender gets it at once; failures only go to the log. */
function afterResponse(job: () => Promise<unknown>): void {
  setImmediate(() => {
    job().catch((e: unknown) => console.error('[cockpit receiver] after response:', e))
  })
}

async function dispatch(event: H3Event, path: string): Promise<Answer> {
  const runtime = useRuntimeConfig(event)
  const config = cockpitConfig(event)
  const method = event.method
  const header = (name: string) => getRequestHeader(event, name) ?? ''
  const now = () => Math.floor(Date.now() / 1000)
  const { crypto, pool, db } = useCockpit(event)

  // Only on the status subdomain, never through the cockpit's own address.
  if (runtime.receiverHost !== '' && getRequestHost(event, { xForwardedHost: false }) !== runtime.receiverHost) {
    return json(404, { error: 'not found' })
  }

  if (path === '/github') {
    const secret = config.releases?.webhookSecret ?? null
    if (config.releases === null || secret === null) return json(404, { error: 'not found' })
    const body = method === 'POST' ? await readCapped(event, WEBHOOK_MAX_BODY) : Buffer.alloc(0)
    const store = new ReleaseRepository(db)
    const [answer, recorded] = await new GitHubWebhook(() => store, config.releases.repo, secret)
      .handle(method, header('x-github-event'), body, header('x-hub-signature-256'))
    // Whether the run publishes and its core version, after the answer (GitHub waits at most 10 s).
    if (recorded && config.github !== null) {
      const github = config.github
      const repo = config.releases.repo
      afterResponse(async () => {
        const key = await readKeyFile(github.privateKeyFile)
        await new ReleaseSync(new GitHubClient(github.clientId, key, github.apiBase), store, repo).complete(now())
      })
    }
    return answer
  }

  const org = config.statusReports?.org ?? null
  const isReport = path === '/reports'
  if (org === null || (isReport && config.bugReports === null)) return json(404, { error: 'not found' })

  if (isReport) {
    if (method !== 'POST') return json(404, { error: 'not found' })
    const body = await readCapped(event, REPORT_MAX_BODY)
    const answer = await new BugReportReceiver(() => new IncomingReportRepository(pool), org, crypto)
      .handle(body, header('x-kompanie-signature'), clientIp(event), now())
    // Create the issue right away; the background job catches up if this fails.
    const reports = config.bugReports!
    const clientId = reports.clientId ?? config.github?.clientId ?? null
    const keyFile = reports.privateKeyFile ?? config.github?.privateKeyFile ?? null
    if (answer.status === 201 && clientId !== null && keyFile !== null) {
      afterResponse(async () => {
        const client = new GitHubClient(clientId, await readKeyFile(keyFile), config.github?.apiBase ?? 'https://api.github.com')
        await new BugReportSync(client, new BugReportRepository(db), job => withLock(pool, BUG_REPORT_LOCK, job), reports.repo, reports.labelPrefix, config.timezone)
          .run(now(), 3)
      })
    }
    return answer
  }

  const body = method === 'POST' ? await readCapped(event, STATUS_MAX_BODY) : Buffer.alloc(0)
  return new Receiver(() => new FormatOneRepository(pool), org, () => new InstallationWriter(pool), crypto)
    .handle(method, path, body, now(), header('x-kompanie-signature'))
}

export default defineEventHandler(async (event) => {
  // /_receiver/reports → /reports, /_receiver/ and /_receiver → /
  const rest = event.path.replace(/^\/_receiver/, '').split('?')[0]!
  const path = rest === '' ? '/' : rest
  let answer: Answer
  try {
    answer = await dispatch(event, path)
  }
  catch (e) {
    // Details go to the server log only.
    console.error('[cockpit receiver]', e)
    answer = json(500, { error: 'internal' })
  }
  setResponseStatus(event, answer.status)
  setResponseHeaders(event, HEADERS)
  return JSON.stringify(answer.body)
})
