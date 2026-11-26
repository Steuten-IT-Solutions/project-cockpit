import { isPhpArray, isPhpInt, isPhpObject, phpEntries, phpList } from '../json'
import { utc } from '../time'

// Validates one status report of a company app (src/Status/StatusReport.php). Format 1 is
// unsigned, so anything may arrive: only known fields with expected shapes are kept.
// Formats 2 and 3 (Kompanie-App-Template docs/STATUSMELDUNGEN.md) are checked strictly
// against a whitelist; signature, replay window and nonce are checked by the receiver.

/** Traffic-light levels of a check. */
export const LEVELS = ['ok', 'warn', 'error', 'off']
/** How background tasks are triggered: real cron, page views only, or WP-Cron. */
export const CRON_KINDS = ['real', 'pseudo', 'wp']
/** Error and event codes (fixed codes, never texts). */
const CODE = /^[A-Z0-9_]{1,40}$/
const MAX_CHECKS = 20
const MAX_ERRORS = 30
/** Causes of an error code: fixed parts and patterns, never texts. */
const CAUSE = /^[a-z][a-z0-9_]{0,63}$/
const MAX_CAUSES = 60
const MAX_FEATURES = 30
const MAX_USERS = 100000
/** Earliest timestamp taken from a report (2020-01-01); older values are dropped. */
const MIN_TIMESTAMP = 1577836800
/** Clock skew tolerated for timestamps in the future. */
const MAX_SKEW = 86400

/** A format 1 row (status_reports); booleans as 0/1 like the PHP cockpit stores them. */
export interface StatusRow {
  kompanie: string
  variant: string
  version: string
  php: string
  dbDriver: string
  updateOk: number | null
  updateAt: string | null
  updateTo: string | null
  updateCheckOk: number
  galleryOk: number | null
  galleryAt: string | null
  sentAt: string | null
}

export interface Usage { users: number, d1: number, d7: number, d30: number, areas: Record<string, number> }

export interface Format2 extends StatusRow {
  installation: string
  kind: 'heartbeat' | 'event'
  event: string | null
  checks: Record<string, string>
  errors: Record<string, number>
  details: Record<string, Record<string, number>>
  detail: string | null
  cronKind: string
  cronLast: string | null
  features: string[]
  maintenance: number
  sent: number
  nonce: string
  key: string | null
  usage: Usage | null
}

function companyPattern(org: string): RegExp {
  return new RegExp(`^${org.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}/[A-Za-z0-9_.-]{1,100}$`)
}

/** A Unix timestamp from the report as UTC DATETIME, or null if it is implausible. */
function time(value: unknown, now: number): string | null {
  if (!isPhpInt(value) || value < MIN_TIMESTAMP || value > now + MAX_SKEW) return null
  return utc(0, value * 1000)
}

function field(record: unknown, key: string): unknown {
  return isPhpArray(record) && !Array.isArray(record) ? record[key] : undefined
}

/** null if the report is not a valid format 1 report of the organisation. */
export function fromPayload(input: unknown, org: string, now: number): StatusRow | null {
  if (!isPhpArray(input) || Array.isArray(input) || input.format !== 1) return null
  const { kompanie, version, variant } = input
  if (typeof kompanie !== 'string' || !companyPattern(org).test(kompanie)
    || typeof version !== 'string' || !/^\d{1,4}(\.\d{1,6}){2,3}$/.test(version)
    || (variant !== 'wordpress' && variant !== 'standalone')) {
    return null
  }
  const php = input.php
  const database = input.database
  const update = isPhpArray(input.update) ? input.update : null
  const gallery = isPhpArray(input.gallery) ? input.gallery : null
  const updateTo = field(update, 'to')
  return {
    kompanie,
    variant,
    version,
    php: typeof php === 'string' && /^\d{1,2}\.\d{1,2}$/.test(php) ? php : '?',
    dbDriver: database === 'mysql' || database === 'sqlite' ? database : '?',
    updateOk: update === null ? null : (field(update, 'ok') === true ? 1 : 0),
    updateAt: update === null ? null : time(field(update, 'at'), now),
    updateTo: typeof updateTo === 'string' && /^[0-9.]{1,30}$/.test(updateTo) ? updateTo : null,
    updateCheckOk: input.updateCheckOk === true ? 1 : 0,
    galleryOk: gallery === null ? null : (field(gallery, 'ok') === true ? 1 : 0),
    galleryAt: gallery === null ? null : time(field(gallery, 'at'), now),
    sentAt: time(input.sent, now),
  }
}

/** null if the report is not a valid format 2 or 3 report of the organisation. */
export function fromFormat2(input: unknown, org: string, now: number): Format2 | null {
  if (!isPhpArray(input) || Array.isArray(input) || (input.format !== 2 && input.format !== 3)) return null
  const base = fromPayload({ ...input, format: 1 }, org, now)
  const { installation, nonce, kind, sent } = input
  if (base === null || typeof installation !== 'string' || !/^[0-9a-f]{32}$/.test(installation)
    || typeof nonce !== 'string' || !/^[0-9a-f]{16}$/.test(nonce)
    || (kind !== 'heartbeat' && kind !== 'event') || !isPhpInt(sent)) {
    return null
  }
  let event: string | null = null
  if (kind === 'event') {
    if (typeof input.event !== 'string' || !CODE.test(input.event)) return null
    event = input.event
  }
  // Cause of the event, only if the app knows one; a heartbeat has none.
  const detail = input.detail ?? null
  if (detail !== null && (kind !== 'event' || typeof detail !== 'string' || !CAUSE.test(detail))) return null
  const key = input.key ?? null
  if (key !== null && (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key))) return null

  const checks = checkLevels(input.checks ?? null)
  const errors = errorCounts(input.errors ?? null)
  // Older app versions send no causes: missing counts as none (isset: null counts as missing).
  const details = input.details !== undefined && input.details !== null ? causes(input.details) : {}
  const features = featureList(input.features ?? null)
  // Usage figures only in a heartbeat; missing (format 2, older app versions) means none, not zero.
  let usage: Usage | null = null
  if (input.usage !== undefined && input.usage !== null) {
    usage = kind === 'heartbeat' ? usageFigures(input.usage) : null
    if (usage === null) return null
  }
  const cron = isPhpArray(input.cron) ? input.cron : {}
  const cronKind = field(cron, 'kind')
  if (checks === null || errors === null || details === null || features === null || typeof cronKind !== 'string' || !CRON_KINDS.includes(cronKind)) {
    return null
  }
  return {
    ...base,
    installation,
    kind,
    event,
    checks,
    errors,
    details,
    detail: detail as string | null,
    cronKind,
    cronLast: time(field(cron, 'last'), now),
    features,
    // Maintenance mode: true only, the reason is never sent.
    maintenance: input.maintenance === true ? 1 : 0,
    sent,
    nonce,
    key: key as string | null,
    usage,
  }
}

function count(value: unknown): number | null {
  return isPhpInt(value) && value >= 0 && value <= MAX_USERS ? value : null
}

function usageFigures(value: unknown): Usage | null {
  if (!isPhpObject(value, 10)) return null
  const active = field(value, 'active')
  const areasIn = field(value, 'areas')
  if (!isPhpObject(active, 10) || !isPhpObject(areasIn, MAX_FEATURES + 2)) return null
  const users = count(field(value, 'users'))
  const d1 = count(field(active, 'd1'))
  const d7 = count(field(active, 'd7'))
  const d30 = count(field(active, 'd30'))
  if (users === null || d1 === null || d7 === null || d30 === null || d1 > d7 || d7 > d30 || d30 > users) return null
  const areas: Record<string, number> = {}
  for (const [area, raw] of phpEntries(areasIn)) {
    const people = count(raw)
    if (typeof area !== 'string' || !/^[a-z]{1,20}$/.test(area) || people === null) return null
    areas[area] = people
  }
  return { users, d1, d7, d30, areas }
}

function checkLevels(value: unknown): Record<string, string> | null {
  if (!isPhpObject(value, MAX_CHECKS)) return null
  const out: Record<string, string> = {}
  for (const [key, level] of phpEntries(value)) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(key) || typeof level !== 'string' || !LEVELS.includes(level)) return null
    out[key] = level
  }
  return out
}

function errorCounts(value: unknown): Record<string, number> | null {
  if (!isPhpObject(value, MAX_ERRORS)) return null
  const out: Record<string, number> = {}
  for (const [code, n] of phpEntries(value)) {
    if (typeof code !== 'string' || !CODE.test(code) || !isPhpInt(n) || n <= 0 || n > 1000000) return null
    out[code] = n
  }
  return out
}

function causes(value: unknown): Record<string, Record<string, number>> | null {
  if (!isPhpObject(value, MAX_ERRORS)) return null
  const out: Record<string, Record<string, number>> = {}
  for (const [code, list] of phpEntries(value)) {
    if (typeof code !== 'string' || !CODE.test(code) || !isPhpObject(list, MAX_CAUSES)) return null
    for (const [cause, n] of phpEntries(list)) {
      if (typeof cause !== 'string' || !CAUSE.test(cause) || !isPhpInt(n) || n <= 0 || n > 1000000) return null
      ;(out[code] ??= {})[cause] = n
    }
  }
  return out
}

function featureList(value: unknown): string[] | null {
  const list = phpList(value)
  if (list === null || list.length > MAX_FEATURES) return null
  const out: string[] = []
  for (const feature of list) {
    if (typeof feature !== 'string' || !/^[a-z]{1,20}$/.test(feature)) return null
    out.push(feature)
  }
  return out
}
