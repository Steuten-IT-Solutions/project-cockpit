import { createHmac } from 'node:crypto'
import { JsonError, phpJsonDecode } from '../json'
import type { ReleaseRepository } from '../repositories/releases'
import { type Answer, hashEquals, json } from '../status/receiver'
import { isRecord } from '../text'
import { isPublishingJob, releaseFromApi } from './run'

// The GitHub App's webhook at POST /github of the status subdomain (src/Releases/GitHubWebhook.php),
// so the cockpit learns within seconds that a release starts or ends. Only "workflow_run" and
// "workflow_job" of the template repository are used; everything else is acknowledged and ignored.
// Every delivery must carry X-Hub-Signature-256. Deliveries have no timestamp, so a recorded one
// could be sent again; it can only restore an older state, which upsert() ignores.

/** workflow_run payloads are some 30 KiB; GitHub caps payloads at 25 MB. */
export const MAX_BODY = 1048576

export type WebhookStore = Pick<ReleaseRepository, 'upsert' | 'markPublishing'>

export class GitHubWebhook {
  constructor(private readonly store: () => WebhookStore, private readonly repo: string, private readonly secret: string) {}

  /** Returns the answer and whether a run was recorded (then complete it via ReleaseSync). */
  async handle(method: string, event: string, body: Buffer, signature: string): Promise<[Answer, boolean]> {
    if (method !== 'POST') return [json(404, { error: 'not found' }), false]
    if (body.length > MAX_BODY) return [json(413, { error: 'too large' }), false]
    const expected = `sha256=${createHmac('sha256', this.secret).update(body).digest('hex')}`
    if (!hashEquals(expected, signature)) return [json(401, { error: 'signature' }), false]
    // "ping" when the webhook is set up, and events nobody asked for.
    if (event !== 'workflow_run' && event !== 'workflow_job') return [json(200, { ok: true }), false]
    let payload: unknown
    try {
      payload = phpJsonDecode(body, 64)
    }
    catch (e) {
      if (e instanceof JsonError) return [json(400, { error: 'invalid' }), false]
      throw e
    }
    const repository = isRecord(payload) && isRecord(payload.repository) ? payload.repository.full_name : null
    if (typeof repository !== 'string' || repository.toLowerCase() !== this.repo.toLowerCase()) {
      return [json(200, { ok: true }), false]
    }
    if (event === 'workflow_run') {
      const run = (payload as Record<string, unknown>).workflow_run
      const row = isRecord(run) ? releaseFromApi(run) : null
      if (row === null) return [json(200, { ok: true }), false]
      await this.store().upsert(row)
      return [json(200, { ok: true }), true]
    }
    const job = (payload as Record<string, unknown>).workflow_job
    if (!isRecord(job) || typeof job.run_id !== 'number' || !Number.isSafeInteger(job.run_id) || !isPublishingJob(job)) {
      return [json(200, { ok: true }), false]
    }
    await this.store().markPublishing(job.run_id)
    // Completing reads the core version of the run that now publishes.
    return [json(200, { ok: true }), true]
  }
}
