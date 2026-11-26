/** UTC timestamp as stored in the database: 'YYYY-MM-DD HH:MM:SS', like PHP's gmdate('Y-m-d H:i:s'). */
export function utc(offsetSeconds = 0, now = Date.now()): string {
  return new Date(now + offsetSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

/** Seconds since the epoch for a stored UTC timestamp. */
export function utcSeconds(value: string): number {
  return Math.floor(Date.parse(`${value.replace(' ', 'T')}Z`) / 1000)
}
