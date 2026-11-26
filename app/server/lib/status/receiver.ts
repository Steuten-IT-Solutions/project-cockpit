import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Crypto } from '../crypto'
import { JsonError, phpJsonDecode } from '../json'
import { utc } from '../time'
import { type Format2, fromFormat2, fromPayload, type StatusRow } from './report'

// Accepts status reports at POST / of the status subdomain (src/Status/Receiver.php).
//
// Format 1 (daily, unsigned; until all installations are updated): 2000 stored rows; rows
// without a new report for 60 days are removed.
//
// Formats 2 and 3: hourly heartbeats and events, signed with HMAC-SHA256 (header
// X-Kompanie-Signature) and a secret per installation. The secret is learned from the first
// report of an unknown installation (field "key", trust on first use) and stored encrypted;
// later reports must carry a valid signature, and a "key" never replaces it. "sent" must lie
// within REPLAY_WINDOW of the receiver's clock and "nonce" must be new.
//
// Both: at most MAX_BODY per report and 2000 reports per hour in total. The database is only
// opened once a report passed validation, so junk requests never touch it.

export const MAX_BODY = 16384
export const MAX_PER_HOUR = 2000
export const MAX_ROWS = 2000
export const KEEP_DAYS = 60
export const MAX_INSTALLATIONS = 2000
export const REPLAY_WINDOW = 600

export interface Answer { status: number, body: Record<string, unknown> }

export function json(status: number, body: Record<string, unknown>): Answer {
  return { status, body }
}

/** Signature header value: "sha256=" and the hex HMAC-SHA256 keyed with the secret's hex text. */
export function sign(body: Buffer | string, secretHex: string): string {
  return `sha256=${createHmac('sha256', secretHex).update(body).digest('hex')}`
}

/** Constant-time comparison like PHP's hash_equals(). */
export function hashEquals(known: string, given: string): boolean {
  const a = Buffer.from(known)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 'YYYYMMDDHH' in UTC, like gmdate('YmdH'). */
export function hourBucket(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 13).replace(/[-T]/g, '')
}

export interface FormatOneStore {
  countInHour(hour: string, dayAgo: string): Promise<number>
  pruneBefore(cutoff: string): Promise<void>
  exists(kompanie: string, variant: string): Promise<boolean>
  count(): Promise<number>
  save(row: StatusRow, receivedAt: string): Promise<void>
}

export interface InstallationStore {
  find(id: string): Promise<{ kompanie: string, variant: string, secretEnc: string } | null>
  count(): Promise<number>
  companyKnown(kompanie: string): Promise<boolean>
  countInHour(hour: string, dayAgo: string): Promise<number>
  claimNonce(installation: string, nonce: string, now: string): Promise<boolean>
  register(report: Format2, secretEnc: string, now: string): Promise<boolean>
  record(report: Format2, now: string): Promise<void>
}

export class Receiver {
  constructor(
    private readonly reports: () => FormatOneStore,
    private readonly org: string,
    private readonly installations: () => InstallationStore,
    private readonly crypto: Crypto,
  ) {}

  async handle(method: string, path: string, body: Buffer, now: number, signature = ''): Promise<Answer> {
    if (method !== 'POST' || path !== '/') return json(404, { error: 'not found' })
    if (body.length > MAX_BODY) return json(413, { error: 'too large' })
    let payload: unknown
    try {
      payload = phpJsonDecode(body, 8)
    }
    catch (e) {
      if (e instanceof JsonError) return json(400, { error: 'invalid' })
      throw e
    }
    // Format 3 is format 2 with usage figures.
    const format = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>).format : null
    if (format === 2 || format === 3) return this.format2(payload, body, signature, now)

    const row = fromPayload(payload, this.org, now)
    if (row === null) return json(400, { error: 'invalid' })
    const store = this.reports()
    if (await store.countInHour(hourBucket(now), hourBucket(now - 86400)) > MAX_PER_HOUR) {
      return json(429, { error: 'too many reports' })
    }
    // Prune first, then count: a full table frees up once old rows expire.
    await store.pruneBefore(utc(-KEEP_DAYS * 86400, now * 1000))
    if (!(await store.exists(row.kompanie, row.variant)) && await store.count() >= MAX_ROWS) {
      return json(507, { error: 'full' })
    }
    await store.save(row, utc(0, now * 1000))
    return json(200, { ok: true })
  }

  private async format2(payload: unknown, body: Buffer, signature: string, now: number): Promise<Answer> {
    const report = fromFormat2(payload, this.org, now)
    if (report === null) return json(400, { error: 'invalid', code: 'invalid' })
    if (Math.abs(report.sent - now) > REPLAY_WINDOW) return json(409, { error: 'outside the time window', code: 'replay' })

    const store = this.installations()
    // Counted before any other database work, rejected attempts included.
    if (await store.countInHour(hourBucket(now), hourBucket(now - 86400)) > MAX_PER_HOUR) {
      return json(429, { error: 'too many reports', code: 'rate_limited' })
    }
    const at = utc(0, now * 1000)
    let known = await store.find(report.installation)
    if (known === null) {
      if (report.key === null) return json(409, { error: 'unknown installation', code: 'unknown_installation' })
      if (!hashEquals(sign(body, report.key), signature)) return json(401, { error: 'bad signature', code: 'bad_signature' })
      // Only companies with a repository of ours: otherwise anyone could register installations.
      if (!(await store.companyKnown(report.kompanie))) return json(403, { error: 'unknown company', code: 'unknown_company' })
      if (await store.count() >= MAX_INSTALLATIONS) return json(507, { error: 'full', code: 'full' })
      if (!(await store.register(report, this.crypto.encrypt(report.key), at))) {
        // Registered by a parallel first report: its secret decides.
        known = await store.find(report.installation)
      }
    }
    // The stored secret decides; a "key" in the report never replaces it.
    if (known !== null && !hashEquals(sign(body, this.crypto.decrypt(known.secretEnc)), signature)) {
      return json(401, { error: 'bad signature', code: 'bad_signature' })
    }
    if (!(await store.claimNonce(report.installation, report.nonce, at))) {
      return json(409, { error: 'report seen before', code: 'replay' })
    }
    await store.record(report, at)
    return json(201, { ok: true })
  }
}
