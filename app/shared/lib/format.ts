// Display formats shared by the server and the pages (German UI, like src/View.php
// and src/Projects/ProjectView.php of the PHP cockpit). Pure functions, unit tested.

/** Seconds since the epoch of a stored UTC timestamp ('YYYY-MM-DD HH:MM:SS'), or null. */
export function utcSeconds(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return null
  }
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** A stored UTC timestamp as "26.11.2026 16:05" in the given time zone; "–" if empty. */
export function localTime(utc: string | null | undefined, timezone: string): string {
  const seconds = utcSeconds(utc)
  if (seconds === null) {
    return '–'
  }
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(seconds * 1000))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

/** Relative age in German, e.g. "vor 3 Tagen". `now` in seconds, from the server. */
export function age(utc: string | null | undefined, now: number): string {
  const ts = utcSeconds(utc)
  if (ts === null) {
    return '–'
  }
  const diff = Math.max(0, now - ts)
  const div = (a: number, b: number) => Math.floor(a / b)
  if (diff < 3600) return `vor ${Math.max(1, div(diff, 60))} Min.`
  if (diff < 86400) return `vor ${div(diff, 3600)} Std.`
  if (diff < 2 * 86400) return 'gestern'
  if (diff < 60 * 86400) return `vor ${div(diff, 86400)} Tagen`
  if (diff < 730 * 86400) return `vor ${div(diff, 30 * 86400)} Monaten`
  return `vor ${div(diff, 365 * 86400)} Jahren`
}

/** 1234.5 → "1.234,50": two decimals, German separators, like PHP's number_format(x, 2, ',', '.'). */
export function decimal(value: number): string {
  const cents = Math.round(Math.abs(value) * 100)
  const whole = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `${value < 0 && cents > 0 ? '-' : ''}${whole},${fraction}`
}

/**
 * Compares two version strings like PHP's version_compare(): -1, 0 or 1.
 * Needed so that "newer release available" means the same as in the PHP cockpit.
 */
export function versionCompare(a: string, b: string): number {
  const parts = (v: string) => canonical(v).split('.').filter(p => p !== '')
  const pa = parts(a)
  const pb = parts(b)
  const n = Math.min(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const c = comparePart(pa[i]!, pb[i]!)
    if (c !== 0) return c
  }
  if (pa.length > n) return isDigits(pa[n]!) ? 1 : versionCompare(pa.slice(n).join('.'), '#N#')
  if (pb.length > n) return isDigits(pb[n]!) ? -1 : versionCompare('#N#', pb.slice(n).join('.'))
  return 0
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s)
}

function canonical(v: string): string {
  if (v === '') return ''
  const digit = (c: string) => c >= '0' && c <= '9'
  const nonDigit = (c: string) => !digit(c) && c !== '.'
  let out = v[0]!
  let last = v[0]!
  for (const c of v.slice(1)) {
    if (c === '-' || c === '_' || c === '+') {
      if (!out.endsWith('.')) out += '.'
    }
    else if ((nonDigit(last) && digit(c)) || (digit(last) && nonDigit(c))) {
      if (!out.endsWith('.')) out += '.'
      out += c
    }
    else if (!/[A-Za-z0-9]/.test(c)) {
      if (!out.endsWith('.')) out += '.'
    }
    else {
      out += c
    }
    last = c
  }
  return out
}

const SPECIAL: [string, number][] = [['dev', 0], ['alpha', 1], ['a', 1], ['beta', 2], ['b', 2], ['RC', 3], ['rc', 3], ['#', 4], ['pl', 5], ['p', 5]]

function special(form: string): number {
  return SPECIAL.find(([name]) => form.startsWith(name))?.[1] ?? -1
}

function comparePart(a: string, b: string): number {
  if (isDigits(a) && isDigits(b)) {
    return Math.sign(Number.parseInt(a, 10) - Number.parseInt(b, 10))
  }
  const fa = isDigits(a) ? '#N#' : a
  const fb = isDigits(b) ? '#N#' : b
  return Math.sign(special(fa) - special(fb))
}
