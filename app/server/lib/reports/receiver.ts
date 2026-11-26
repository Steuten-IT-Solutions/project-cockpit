import type { Crypto } from '../crypto'
import { JsonError, phpJsonDecode } from '../json'
import { type Answer, hashEquals, hourBucket, json, REPLAY_WINDOW, sign } from '../status/receiver'
import { utc } from '../time'
import { fromPayload, type Incoming } from './bugReport'

// Accepts bug reports at POST /reports of the status subdomain (src/Reports/BugReportReceiver.php,
// Kompanie-App-Template docs/FEHLERMELDUNGEN.md). Signed like status reports with the
// installation's secret: the one stored from its status reports, else the one learned from its
// first bug report (trust on first use; a "key" never replaces a stored secret).
// Answers 2xx only once the report is stored; the issue is created afterwards (BugReportSync).

/** 2 MB image as base64 plus the texts and JSON around it. */
export const MAX_BODY = 3_000_000
export const PER_IP_HOUR = 30
export const PER_INSTALLATION_HOUR = 10
export const TOTAL_HOUR = 200

export interface IncomingReportStore {
  secretFor(installation: string): Promise<{ kompanie: string, secretEnc: string } | null>
  registerSecret(installation: string, kompanie: string, secretEnc: string, now: string): Promise<boolean>
  companyKnown(kompanie: string): Promise<boolean>
  hit(bucket: string, hour: string): Promise<number>
  claimNonce(installation: string, nonce: string, now: string): Promise<boolean>
  exists(installation: string, reportId: string): Promise<boolean>
  store(report: Incoming, now: string): Promise<void>
}

export class BugReportReceiver {
  constructor(private readonly store: () => IncomingReportStore, private readonly org: string, private readonly crypto: Crypto) {}

  /** @param ip the client address, only used as a keyed hash for the rate limit */
  async handle(body: Buffer, signature: string, ip: string, now: number): Promise<Answer> {
    if (body.length > MAX_BODY) return json(413, { error: 'too large', code: 'too_large' })
    let payload: unknown
    try {
      payload = phpJsonDecode(body, 8)
    }
    catch (e) {
      if (e instanceof JsonError) return json(400, { error: 'invalid', code: 'invalid' })
      throw e
    }
    const report = fromPayload(payload, this.org, now)
    if (report === null) return json(400, { error: 'invalid', code: 'invalid' })
    if (Math.abs(report.sent - now) > REPLAY_WINDOW) return json(409, { error: 'outside the time window', code: 'replay' })

    const store = this.store()
    const hour = hourBucket(now)
    // Counted before any other database work, rejected attempts included (each counter only
    // once the one before passed, as in PHP).
    if (await store.hit(`ip:${this.crypto.hash('bug-report-ip', ip)}`, hour) > PER_IP_HOUR
      || await store.hit(`inst:${report.installation}`, hour) > PER_INSTALLATION_HOUR
      || await store.hit('all', hour) > TOTAL_HOUR) {
      return json(429, { error: 'too many reports', code: 'rate_limited' })
    }

    let known = await store.secretFor(report.installation)
    if (known === null) {
      if (report.key === null) return json(409, { error: 'unknown installation', code: 'unknown_installation' })
      if (!hashEquals(sign(body, report.key), signature)) return json(401, { error: 'bad signature', code: 'bad_signature' })
      if (!(await store.companyKnown(report.kompanie))) return json(403, { error: 'unknown company', code: 'unknown_company' })
      if (!(await store.registerSecret(report.installation, report.kompanie, this.crypto.encrypt(report.key), utc(0, now * 1000)))) {
        // Registered by a parallel request: its secret decides.
        known = await store.secretFor(report.installation)
      }
    }
    if (known !== null && !hashEquals(sign(body, this.crypto.decrypt(known.secretEnc)), signature)) {
      return json(401, { error: 'bad signature', code: 'bad_signature' })
    }
    const at = utc(0, now * 1000)
    if (!(await store.claimNonce(report.installation, report.nonce, at))) return json(409, { error: 'report seen before', code: 'replay' })
    // Sent again because the app missed our answer: already stored, no second issue.
    if (await store.exists(report.installation, report.reportId)) return json(200, { ok: true, duplicate: true })
    await store.store(report, at)
    return json(201, { ok: true })
  }
}
