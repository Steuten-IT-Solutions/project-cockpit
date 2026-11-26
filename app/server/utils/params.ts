import type { H3Event } from 'h3'

/** A positive integer route parameter (e.g. /api/projects/123); 404 otherwise, like an unknown URL. */
export function idParam(event: H3Event, name = 'id'): number {
  const value = getRouterParam(event, name) ?? ''
  if (!/^\d{1,19}$/.test(value)) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  return Number(value)
}

/** A string field of a JSON body; '' if missing or not a string. */
export function bodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' ? value : ''
}
