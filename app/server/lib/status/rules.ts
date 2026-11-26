import type { Alert, Installation } from '#shared/types/cockpit'
import { checkLabel, codeLabel, companyName } from '#shared/lib/status'
import { utcSeconds } from '#shared/lib/format'
import { cut } from '../text'

// Which alerts should be open right now (src/Status/AlertRules.php). Pure: no database, no clock.
// - silent: no heartbeat for 2 h (real cron, WP-Cron) or 24 h (pseudo-cron, tasks only on page views)
// - check:<key>: a traffic light is red (not in maintenance mode: tasks are paused on purpose)
// - event:<code>: a severe error was reported in the last 24 h (not CHECK_ERROR: the red light has its own alert)
// - release:<version>: several installations on one version reported severe errors in the last 24 h.
//   Only installations known for a day count, so freshly registered ones cannot raise it.
// Yellow (warn, error counts) is shown in the cockpit but raises no alert.

export const SILENT_REAL = 2 * 3600
export const SILENT_PSEUDO = 24 * 3600
/** An event keeps its alert open this long after it was last reported. */
export const EVENT_HOLD = 24 * 3600
export const RELEASE_MIN = 2
export const RELEASE_CODES = ['UPDATE_FAILED', 'PHP_FATAL', 'DB_ERROR']
export const RELEASE_MIN_AGE = 86400

export interface Wanted {
  installationId: string | null
  kompanie: string
  variant: string | null
  alertKey: string
  detail: string
}

export interface StatusEvent { installationId: string, code: string, detail: string | null, version: string, receivedAt: string }

type InstallationLike = Pick<Installation, 'id' | 'kompanie' | 'variant' | 'cronKind' | 'checks' | 'maintenance' | 'firstSeen' | 'lastHeartbeat'>

/** Wanted alerts by identity (installation id or kompanie, plus alert key). Insertion order matters for opening. */
export function wantedAlerts(installations: InstallationLike[], events: StatusEvent[], now: number): Map<string, Wanted> {
  const byId = new Map(installations.map(i => [i.id, i]))
  const wanted = new Map<string, Wanted>()
  const add = (i: InstallationLike, key: string, detail: string) => {
    wanted.set(`${i.id}|${key}`, { installationId: i.id, kompanie: i.kompanie, variant: i.variant, alertKey: key, detail: cut(detail, 255) })
  }
  for (const i of installations) {
    const last = utcSeconds(i.lastHeartbeat) ?? utcSeconds(i.firstSeen)
    const limit = i.cronKind === 'pseudo' ? SILENT_PSEUDO : SILENT_REAL
    if (last !== null && now - last > limit) {
      add(i, 'silent', `kein Lebenszeichen seit über ${Math.floor(limit / 3600)} Stunden`)
    }
    if (!i.maintenance) {
      for (const [key, level] of Object.entries(i.checks)) {
        if (level === 'error') add(i, `check:${key}`, `${checkLabel(key)}: rot`)
      }
    }
  }
  const red = new Map<string, Set<string>>()
  for (const event of events) {
    const i = byId.get(event.installationId)
    const at = utcSeconds(event.receivedAt)
    if (i === undefined || at === null || now - at > EVENT_HOLD || event.code === 'CHECK_ERROR') continue
    add(i, `event:${event.code}`, codeLabel(event.code) + (event.detail !== null ? ` (${event.detail})` : ''))
    const since = utcSeconds(i.firstSeen)
    if (RELEASE_CODES.includes(event.code) && since !== null && now - since >= RELEASE_MIN_AGE) {
      if (!red.has(event.version)) red.set(event.version, new Set())
      red.get(event.version)!.add(i.id)
    }
  }
  for (const [version, ids] of red) {
    if (ids.size < RELEASE_MIN) continue
    const names = [...new Set([...ids].map(id => companyName(byId.get(id)!.kompanie)))]
    const key = `release:${version}`
    wanted.set(`*|${key}`, {
      installationId: null,
      kompanie: '*',
      variant: null,
      alertKey: key,
      detail: cut(`Schwere Fehler nach Release ${version} (${ids.size} Installationen: ${names.join(', ')}) – zurückziehen?`, 255),
    })
  }
  return wanted
}

export function identity(alert: Pick<Alert, 'installationId' | 'kompanie' | 'alertKey'>): string {
  return `${alert.installationId ?? alert.kompanie}|${alert.alertKey}`
}

/** Compares the wanted alerts with the open ones. */
export function diffAlerts(wanted: Map<string, Wanted>, open: Pick<Alert, 'id' | 'installationId' | 'kompanie' | 'alertKey'>[]) {
  const out: { open: Wanted[], touch: { id: number, detail: string }[], resolve: number[] } = { open: [], touch: [], resolve: [] }
  const seen = new Set<string>()
  for (const alert of open) {
    const id = identity(alert)
    const w = wanted.get(id)
    if (w !== undefined && !seen.has(id)) {
      seen.add(id)
      out.touch.push({ id: alert.id, detail: w.detail })
    }
    else {
      out.resolve.push(alert.id)
    }
  }
  for (const [id, alert] of wanted) {
    if (!seen.has(id)) out.open.push(alert)
  }
  return out
}
