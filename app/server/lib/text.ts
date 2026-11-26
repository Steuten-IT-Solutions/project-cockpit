// Small text helpers that mirror PHP functions used by the ported code.

/** Replaces runs of control and invisible characters by a space and trims, like preg_replace('/[^\P{C}]+/u', ' '). */
export function printable(value: string): string {
  return value.replace(/\p{C}+/gu, ' ').trim()
}

/** First `max` characters (code points), like mb_substr($value, 0, $max). */
export function cut(value: string, max: number): string {
  return [...value].slice(0, max).join('')
}

/** An ISO time from an API as stored UTC 'YYYY-MM-DD HH:MM:SS', or null. */
export function apiTime(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
