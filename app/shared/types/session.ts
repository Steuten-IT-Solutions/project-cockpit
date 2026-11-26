// Shared between the server (server/utils/state.ts) and the pages.
export interface CockpitSession {
  user: { id: number, username: string } | null
  /** Password accepted, second factor still missing. */
  pending: boolean
  /** Sent as X-CSRF-Token with every request that changes something. */
  csrf: string
  /** Time zone for displaying times, e.g. Europe/Berlin. */
  timezone: string
  /** One-time message for the next page. */
  flash: string | null
}
