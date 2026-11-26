import type { GitHubClient } from '../github/client'
import { reason } from '../github/client'
import type { ReleaseRepository } from '../repositories/releases'
import { isRecord } from '../text'
import { utc } from '../time'
import { coreVersion, isPublishingJob, releaseFromApi } from './run'

// Reads the release runs of the template repository through the GitHub App, with a
// token limited to that repository and read access (src/Releases/ReleaseSync.php).
// The webhook records runs within seconds; this completes them (does a sync run publish?
// which core version?) and catches runs whose webhook got lost.

/** Pending runs older than this are not looked at again. */
const PENDING_DAYS = 7
/** Runs without a release are kept this long, so their jobs are not read again. */
const KEEP_QUIET_DAYS = 30
const KEEP_DAYS = 400

/** What the sync needs from the database; tests use an in-memory copy. */
export type ReleaseStore = Pick<ReleaseRepository, 'upsert' | 'pending' | 'setPublishing' | 'setCoreVersion' | 'prune'>

export class ReleaseSync {
  constructor(private readonly client: GitHubClient, private readonly store: ReleaseStore, private readonly repo: string) {}

  private base(): string {
    const [owner, name] = this.repo.split('/', 2) as [string, string]
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  }

  private async token(now: number): Promise<string> {
    const [owner, name] = this.repo.split('/', 2) as [string, string]
    for (const installation of await this.client.installations(now)) {
      if (installation.account.toLowerCase() === owner.toLowerCase()) {
        return this.client.installationToken(installation.id, now, [name], { actions: 'read', contents: 'read', metadata: 'read' })
      }
    }
    throw new Error(`Die GitHub App ist nicht bei ${owner} installiert.`)
  }

  /** Background job: the latest runs of both workflows, then the missing details. */
  async run(now: number): Promise<{ runs: number }> {
    const token = await this.token(now)
    let seen = 0
    for (const path of [
      '/actions/workflows/kern-freigeben.yml/runs?per_page=5',
      '/actions/workflows/kompanien-abgleichen.yml/runs?per_page=10&branch=develop',
      '/actions/workflows/kompanien-abgleichen.yml/runs?per_page=10&branch=main',
    ]) {
      const [status, body] = await this.client.get(this.base() + path, token)
      // 404: the workflow does not exist (yet) in this repository.
      if (status === 404) continue
      if (status !== 200 || !isRecord(body) || !Array.isArray(body.workflow_runs)) {
        throw new Error(`GitHub returned ${status} for the workflow runs${reason(body)}.`)
      }
      for (const run of body.workflow_runs) {
        const row = isRecord(run) ? releaseFromApi(run) : null
        if (row !== null) {
          await this.store.upsert(row)
          seen++
        }
      }
    }
    await this.complete(now, token)
    await this.store.prune(utc(-KEEP_QUIET_DAYS * 86400, now * 1000), utc(-KEEP_DAYS * 86400, now * 1000))
    return { runs: seen }
  }

  /** Fills in whether sync runs publish and the core version of releasing runs. */
  async complete(now: number, token?: string): Promise<void> {
    const pending = await this.store.pending(utc(-PENDING_DAYS * 86400, now * 1000), 20)
    if (pending.length === 0) return
    token ??= await this.token(now)
    for (const run of pending) {
      let publishing = run.publishing
      if (publishing === null) {
        const [status, body] = await this.client.get(`${this.base()}/actions/runs/${run.id}/jobs?per_page=100`, token)
        if (status !== 200 || !isRecord(body) || !Array.isArray(body.jobs)) continue
        const found = body.jobs.some(job => isRecord(job) && isPublishingJob(job))
        // While "finden" still runs, a run without publishing jobs may still get some.
        if (found || run.status === 'completed') {
          await this.store.setPublishing(run.id, found)
          publishing = found ? 1 : 0
        }
      }
      if (publishing === 1 && run.coreVersion === null) {
        const [status, body] = await this.client.get(`${this.base()}/contents/VERSION?ref=${run.headSha}`, token)
        const version = status === 200 ? coreVersion(body) : null
        if (version !== null) await this.store.setCoreVersion(run.id, version)
      }
    }
  }
}
