// Keeps a list's search and filters in the page address (?q=…&status=…), so going back from a
// record, reloading or sharing the link shows the list exactly as it was. Pure, so it is unit
// tested; app/composables/useListState.ts connects it to the router.

type Query = Record<string, unknown>

/**
 * Reads the filter values from the address. Values that are missing, repeated or not allowed
 * (e.g. an old link with a status that no longer exists) fall back to the default.
 */
export function readListQuery<T extends Record<string, string>>(query: Query, defaults: T, allowed: Partial<Record<keyof T, readonly string[]>> = {}): T {
  const state = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const value = query[key]
    if (typeof value !== 'string') continue
    const options = allowed[key]
    if (options !== undefined && !options.includes(value)) continue
    state[key] = value as T[typeof key]
  }
  return state
}

/**
 * Writes the filter values into the address. Only values that differ from the default appear,
 * so an unfiltered list keeps a short address; other parameters (e.g. the page's own) stay.
 */
export function writeListQuery<T extends Record<string, string>>(query: Query, state: T, defaults: T): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!(key in defaults) && typeof value === 'string') next[key] = value
  }
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const value = state[key]
    if (value !== undefined && value !== defaults[key]) next[key] = value
  }
  return next
}
