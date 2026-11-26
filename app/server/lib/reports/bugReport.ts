import { isRecord } from '../text'
import { imageSize } from './image'

// Validates one bug report of a company app and renders it as a GitHub issue
// (src/Reports/BugReport.php). The payload is built by the company app template
// (docs/FEHLERMELDUNGEN.md there). Everything arrives from the internet, so only known
// fields with the expected shapes are kept. Free text is never interpreted: in the issue it
// sits in code blocks and code spans, so it can neither mention people, reference issues
// nor inject markup.

export const MAX_TEXT = 2000
export const MAX_SCREENSHOT = 2 * 1024 * 1024
/** Longest edge and area of a screenshot in pixels, as in the app. */
export const MAX_EDGE = 10000
export const MAX_PIXELS = 40_000_000
export const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MIN_TIMESTAMP = 1577836800

export interface Fields {
  description: string
  expected: string
  page: string
  version: string
  variant: string
  userAgent: string
  role: string
  name: string | null
  lastError: string | null
  created: number
}

export interface Incoming {
  installation: string
  kompanie: string
  sent: number
  nonce: string
  key: string | null
  reportId: string
  fields: Fields
  screenshot: Buffer | null
  screenshotType: string | null
}

// PHP's /\s+/u: Unicode white space including U+0085 (JavaScript's \s lacks it and adds U+FEFF).
const WHITESPACE = /[\p{Z}\t\n\v\f\r\u0085]+/gu

/** PHP's trim(): only space, tab, line breaks, NUL and vertical tab. */
export function phpTrim(value: string): string {
  return value.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '')
}

function length(value: string): number {
  return [...value].length
}

/** null if the payload is not a valid report of the organisation. */
export function fromPayload(input: unknown, org: string, now: number): Incoming | null {
  if (!isRecord(input) || input.format !== 1 || !isRecord(input.report)) return null
  const r = input.report
  const { installation, kompanie, nonce, sent } = input
  const key = input.key ?? null
  const id = r.id
  const company = new RegExp(`^${org.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}/[A-Za-z0-9_.-]{1,100}$`)
  if (typeof installation !== 'string' || !/^[0-9a-f]{32}$/.test(installation)
    || typeof kompanie !== 'string' || !company.test(kompanie)
    || typeof nonce !== 'string' || !/^[0-9a-f]{16}$/.test(nonce) || !Number.isSafeInteger(sent)
    || (key !== null && (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)))
    || typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
    return null
  }

  const description = text(r.description ?? null, MAX_TEXT, true)
  const expected = text(r.expected ?? '', MAX_TEXT, true)
  const page = text(r.page ?? '', 200, false)
  const userAgent = text(r.userAgent ?? '', 400, false)
  const role = text(r.role ?? null, 100, false)
  // Optional texts: null stays null, anything else must be a valid, non-empty text.
  const rawName = r.name ?? null
  const name = rawName === null ? null : text(rawName, 100, false)
  const rawError = r.lastError ?? null
  const lastError = rawError === null ? null : text(rawError, 500, false)
  const { version, variant, created } = r
  if (description === null || description === '' || expected === null || page === null || userAgent === null
    || role === null || role === ''
    || (rawName !== null && (name === null || name === ''))
    || (rawError !== null && lastError === null)
    || typeof version !== 'string' || !/^[0-9A-Za-z.+-]{1,30}$/.test(version)
    || (variant !== 'wordpress' && variant !== 'standalone')
    || typeof created !== 'number' || !Number.isSafeInteger(created) || created < MIN_TIMESTAMP || created > now + 86400) {
    return null
  }

  let screenshot: Buffer | null = null
  let screenshotType: string | null = null
  const shot = input.screenshot ?? null
  if (shot !== null) {
    const checked = checkScreenshot(shot)
    if (checked === null) return null
    ;[screenshot, screenshotType] = checked
  }

  return {
    installation,
    kompanie,
    sent: sent as number,
    nonce,
    key: key as string | null,
    reportId: id,
    fields: { description, expected, page, version, variant, userAgent, role, name, lastError, created },
    screenshot,
    screenshotType,
  }
}

/** Issue title: the first line of the description, shortened. */
export function title(description: string): string {
  const line = phpTrim(description.split('\n')[0]!).replace(WHITESPACE, ' ')
  const chars = [...line]
  return chars.length > 120 ? `${chars.slice(0, 119).join('').replace(/[ \t\n\r\0\v]+$/, '')}…` : line
}

/** Label of a company: prefix and the repository name, lower case, at most 50 characters (GitHub's limit). */
export function label(prefix: string, kompanie: string): string {
  // strtolower() changes only A–Z; the repository name is ASCII anyway.
  const slug = kompanie.slice(kompanie.lastIndexOf('/') + 1).replace(/[A-Z]/g, c => c.toLowerCase())
  return [...`${prefix}${slug}`].slice(0, 50).join('')
}

/** 'dd.MM.yyyy HH:mm' in the given time zone. */
function localTime(seconds: number, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(seconds * 1000)).map(p => [p.type, p.value]))
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`
}

/** Issue body: a table of the attached details, then description, expectation and screenshot. */
export function body(fields: Fields, kompanie: string, installation: string, reportId: string, screenshotUrl: string | null, timezone: string): string {
  const rows: [string, string][] = [
    ['Kompanie', kompanie],
    ['Seite in der App', fields.page === '' ? '–' : fields.page],
    ['App-Version', `${fields.version} (${fields.variant})`],
    ['Gerät/Browser', fields.userAgent === '' ? '–' : fields.userAgent],
    ['Rolle', fields.role],
    ['Name', fields.name ?? '– (nicht mitgeschickt)'],
    ['Zeit', `${localTime(fields.created, timezone)} (${timezone})`],
    ['Letzte Fehlermeldung', fields.lastError ?? '–'],
    ['Installation', installation],
    ['Meldungs-ID', reportId],
  ]
  let out = '| Angabe | Wert |\n|---|---|\n'
  for (const [name, value] of rows) {
    out += `| ${name} | ${cell(value)} |\n`
  }
  out += `\n### Beschreibung\n\n${block(fields.description)}\n`
  if (fields.expected !== '') {
    out += `\n### Erwartet\n\n${block(fields.expected)}\n`
  }
  if (screenshotUrl !== null) {
    out += `\n### Bildschirmfoto\n\n![Bildschirmfoto](${screenshotUrl}?raw=true)\n\n[Bildschirmfoto öffnen](${screenshotUrl})\n`
  }
  return `${out}\n<sub>Gemeldet über „Fehler melden“ in der App, mit Einwilligung der meldenden Person.</sub>\n`
}

/** Text in a fenced code block whose fence is longer than any backtick run inside. */
export function block(value: string): string {
  const fence = '`'.repeat(Math.max(3, longestRun(value) + 1))
  return `${fence}text\n${value}\n${fence}`
}

/** A table cell as a code span: no mentions, links or markup; pipes escaped for the table. */
export function cell(value: string): string {
  const flat = phpTrim(value.replace(WHITESPACE, ' '))
  const ticks = '`'.repeat(longestRun(flat) + 1)
  return `${ticks} ${flat.replaceAll('|', '\\|')} ${ticks}`
}

function longestRun(value: string): number {
  return Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length))
}

/**
 * Valid Unicode without control characters (line breaks only when multiline), trimmed;
 * null if not a string or too long.
 */
function text(value: unknown, max: number, multiline: boolean): string | null {
  // A lone surrogate is what PHP's json_decode rejects as invalid UTF-8.
  if (typeof value !== 'string' || !value.isWellFormed()) return null
  let v = value.replace(/\r\n|\r/g, '\n')
  // eslint-disable-next-line no-control-regex
  v = multiline ? v.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '') : v.replace(/[\x00-\x1F\x7F]+/g, ' ')
  v = phpTrim(v)
  return length(v) > max ? null : v
}

/** PHP's base64_decode($data, true): white space is skipped, anything else outside the alphabet fails. */
export function strictBase64(data: string): Buffer | null {
  const compact = data.replace(/[ \t\r\n]/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.replace(/=+$/, '').length % 4 === 1) return null
  return Buffer.from(compact, 'base64')
}

/** Base64 image of a known type that really is one, with sane dimensions. */
function checkScreenshot(shot: unknown): [Buffer, string] | null {
  if (!isRecord(shot)) return null
  const { type, data } = shot
  if (typeof type !== 'string' || !(type in TYPES) || typeof data !== 'string') return null
  if (data.length > Math.floor(MAX_SCREENSHOT * 4 / 3) + 8) return null
  const bytes = strictBase64(data)
  if (bytes === null || bytes.length === 0 || bytes.length > MAX_SCREENSHOT) return null
  const info = imageSize(bytes)
  if (info === null || info.mime !== type || info.width < 1 || info.height < 1
    || info.width > MAX_EDGE || info.height > MAX_EDGE || info.width * info.height > MAX_PIXELS) {
    return null
  }
  return [bytes, type]
}
