import type { CockpitSession } from '#shared/types/session'

/** The visitor's session as the pages know it. Filled on the server, kept on the client. */
export function useCockpitSession() {
  return useState<CockpitSession | null>('cockpit-session', () => null)
}

/** Reloads the session state, e.g. after login or logout. */
export async function refreshCockpitSession(): Promise<CockpitSession> {
  const state = useCockpitSession()
  state.value = await $fetch<CockpitSession>('/api/session')
  return state.value
}

/** POST to the cockpit's API with the CSRF token. */
export function cockpitPost<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  const csrf = useCockpitSession().value?.csrf ?? ''
  return $fetch<T>(url, { method: 'POST', body, headers: { 'X-CSRF-Token': csrf } })
}

/** The German message of a failed request, as the server phrased it. */
export function errorMessage(error: unknown): string {
  const data = (error as { data?: { statusMessage?: string, message?: string } }).data
  return data?.statusMessage ?? data?.message ?? 'Etwas ist schiefgelaufen. Bitte versuche es noch einmal.'
}
