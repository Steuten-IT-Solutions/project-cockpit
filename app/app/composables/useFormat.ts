import { age, localTime } from '#shared/lib/format'

/**
 * Formatting with the cockpit's time zone. `now` comes from the server's answer, so
 * the server render and the browser show the same "vor 3 Min.".
 */
export function useFormat() {
  const session = useCockpitSession()
  const timezone = computed(() => session.value?.timezone ?? 'Europe/Berlin')
  return {
    time: (utc: string | null | undefined) => localTime(utc, timezone.value),
    age: (utc: string | null | undefined, now: number) => age(utc, now),
  }
}
