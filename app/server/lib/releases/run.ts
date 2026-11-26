import type { ReleaseRun } from '#shared/types/cockpit'
import { apiTime, cut, isRecord, printable } from '../text'

// Maps GitHub workflow runs and jobs of the company app template to release_runs rows
// (src/Releases/ReleaseRun.php). Pure, so it is tested without the network.
// - "Kernversion freigeben" (kern-freigeben.yml) on main promotes the tested core: stable.
// - "Kompanien abgleichen" (kompanien-abgleichen.yml) publishes: on develop early, on main stable.
//   Most of its runs find nothing; only runs with a job besides "finden" release anything.

export const PROMOTE = 'promote'
export const SYNC = 'sync'

const WORKFLOWS: Record<string, string> = {
  '.github/workflows/kern-freigeben.yml': PROMOTE,
  '.github/workflows/kompanien-abgleichen.yml': SYNC,
}

/** The job of "Kompanien abgleichen" that only looks for companies to publish. */
const FIND_JOB = 'finden'

export type ReleaseRow = Omit<ReleaseRun, 'coreVersion'>

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = printable(value)
  return cleaned === '' ? null : cut(cleaned, max)
}

/** A run of the API or of a webhook as a row; null for runs of other workflows or branches. */
export function releaseFromApi(run: Record<string, unknown>): ReleaseRow | null {
  const path = typeof run.path === 'string' ? run.path.split('@')[0]! : ''
  const workflow = WORKFLOWS[path] ?? null
  const branch = typeof run.head_branch === 'string' ? run.head_branch : ''
  const channel = workflow === PROMOTE && branch === 'main'
    ? 'stable'
    : workflow === SYNC && branch === 'develop' ? 'early' : workflow === SYNC && branch === 'main' ? 'stable' : null
  const id = run.id
  const sha = typeof run.head_sha === 'string' ? run.head_sha : ''
  const url = run.html_url
  const started = apiTime(run.run_started_at) ?? apiTime(run.created_at)
  const updated = apiTime(run.updated_at) ?? started
  if (workflow === null || channel === null || typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{40}$/.test(sha)
    || typeof url !== 'string' || !url.startsWith('https://github.com/') || url.length > 300 || started === null || updated === null) {
    return null
  }
  return {
    id,
    workflow,
    channel,
    branch,
    event: text(run.event, 30) ?? '',
    status: text(run.status, 20) ?? 'queued',
    conclusion: text(run.conclusion, 20),
    // A promotion always releases; whether a sync run does is known from its jobs.
    publishing: workflow === PROMOTE ? 1 : null,
    title: text(run.display_title, 200),
    headSha: sha,
    htmlUrl: url,
    startedAt: started,
    updatedAt: updated,
  }
}

/** Whether a job publishes. Skipped jobs do not: "veroeffentlichen" is skipped when "finden" found nothing. */
export function isPublishingJob(job: Record<string, unknown>): boolean {
  return typeof job.name === 'string' && job.name !== '' && job.name !== FIND_JOB && job.conclusion !== 'skipped'
}

/** The core version from GET /repos/{repo}/contents/VERSION, e.g. "0.1.1"; null if it is not one. */
export function coreVersion(body: unknown): string | null {
  if (!isRecord(body) || body.encoding !== 'base64' || typeof body.content !== 'string') return null
  const raw = body.content.replace(/[\r\n]/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return null
  const version = Buffer.from(raw, 'base64').toString('utf8').trim()
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : null
}
