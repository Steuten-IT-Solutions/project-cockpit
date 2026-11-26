import type { Installation, StatusReport } from '../types/cockpit'
import { utcSeconds, versionCompare } from './format'

// Labels and rules for the status reports of the company apps, like
// src/Status/StatusView.php. German UI text.

/** A format 1 report is sent daily; after this long without one the installation counts as silent. */
export const SILENT_AFTER = 3 * 86400

/** What looks wrong with a format 1 installation, empty if nothing. */
export function reportProblems(report: StatusReport, now: number): string[] {
  const problems: string[] = []
  const received = utcSeconds(report.receivedAt)
  if (received === null || received < now - SILENT_AFTER) problems.push('seit über 3 Tagen keine Meldung')
  if (!report.updateCheckOk) problems.push('Update-Liste nicht erreichbar')
  if (report.updateOk === false) problems.push(`letztes Update${report.updateTo !== null ? ` auf ${report.updateTo}` : ''} gescheitert`)
  if (report.galleryOk === false) problems.push('Galerie-Abgleich mit Fehler')
  return problems
}

/** The release tag if it is newer than the installed version (tags are "v" plus the version), else null. */
export function newerRelease(version: string, releaseTag: string | null | undefined): string | null {
  if (releaseTag === null || releaseTag === undefined) return null
  const released = releaseTag.replace(/^[vV]+/, '')
  if (!/^\d+(\.\d+)+$/.test(released)) return null
  return versionCompare(released, version) > 0 ? releaseTag : null
}

/** German labels of the fixed error and event codes (Kompanie-App-Template Telemetry\Code). */
const CODES: Record<string, string> = {
  UPDATE_FAILED: 'Update gescheitert',
  ROLLBACK: 'Zurückgerollt bzw. Version gewechselt',
  UPDATE_CHECK: 'Update-Liste nicht abrufbar',
  CALENDAR_FETCH: 'Kalender nicht abrufbar',
  GALLERY_SYNC: 'Galerie-Abgleich mit Fehler',
  GALLERY_403: 'Galerie: kein Zugriff auf Google Drive',
  TASK_FAILED: 'Hintergrundaufgabe abgebrochen',
  SERVER_ERROR: 'Interner Fehler bei einer Anfrage',
  DB_ERROR: 'Datenbankfehler',
  PHP_FATAL: 'Schwerer PHP-Fehler',
  DISK_LOW: 'Wenig Speicherplatz',
  CHECK_ERROR: 'Ampel auf Rot gesprungen',
}

/** German labels of the traffic lights of an installation. */
const CHECKS: Record<string, string> = {
  updates: 'Updates',
  gallery: 'Galerie',
  calendar: 'Kalender',
  backup: 'Datensicherung',
  server: 'Server',
  cron: 'Hintergrundaufgaben',
  data: 'Schutz der Daten',
}

/** German labels of the areas in usage figures. */
const AREAS: Record<string, string> = {
  app: 'Allgemein', login: 'Anmeldung', events: 'Termine', calendar: 'Kalender', news: 'News',
  gallery: 'Galerie', points: 'Punkte', penalties: 'Strafen', ranks: 'Dienstgrade', titles: 'Titel',
  attendance: 'Anwesenheit', documents: 'Dokumente', board: 'Schwarzes Brett', polls: 'Umfragen',
  birthdays: 'Geburtstage', inventory: 'Inventar', directory: 'Mitglieder', offices: 'Ämter',
  lists: 'Listen', mail: 'E-Mails', companies: 'Kompanien', sponsors: 'Sponsoren', pages: 'Seiten',
}

/** Below this, usage figures are shown as "< 5": in a small company they could point to a single person. */
export const SMALL_FIGURE = 5

export function areaLabel(area: string): string {
  return AREAS[area] ?? area
}

export function figure(count: number): string {
  return count > 0 && count < SMALL_FIGURE ? `< ${SMALL_FIGURE}` : String(count)
}

/** Areas of the usage figures, most used first, ties by label. */
export function usageAreas(areas: Record<string, number>): { label: string, people: string }[] {
  return Object.entries(areas)
    .map(([key, count]) => ({ label: areaLabel(key), count }))
    .sort((a, b) => b.count - a.count || compareStrings(a.label, b.label))
    .map(r => ({ label: r.label, people: figure(r.count) }))
}

export function codeLabel(code: string): string {
  return CODES[code] ?? code
}

/** Causes of an error code, most frequent first, e.g. "ics_http_404: 2, ics_timeout: 1". */
export function causes(list: Record<string, number>): string {
  return Object.entries(list)
    .sort(([ka, a], [kb, b]) => b - a || compareStrings(ka, kb))
    .map(([cause, count]) => `${cause}: ${count}`)
    .join(', ')
}

export function checkLabel(key: string): string {
  return CHECKS[key] ?? key
}

export function cronLabel(kind: string): string {
  switch (kind) {
    case 'real': return 'Cronjob'
    case 'pseudo': return 'nur bei Seitenaufrufen'
    case 'wp': return 'WP-Cron'
    default: return kind
  }
}

export type Light = 'ok' | 'warn' | 'error' | 'maintenance'

/** Traffic light of a format 2 installation. */
export function light(installation: Pick<Installation, 'checks' | 'errors' | 'maintenance'>, openAlert: boolean): Light {
  if (installation.maintenance) return 'maintenance'
  if (openAlert) return 'error'
  if (Object.values(installation.checks).includes('warn') || Object.keys(installation.errors).length > 0) return 'warn'
  return 'ok'
}

export const LIGHT_LABELS: Record<Light, string> = { ok: 'in Ordnung', warn: 'Hinweise', error: 'Warnung', maintenance: 'in Wartung' }

/** German text of an alert key, e.g. "check:gallery" → "Ampel rot: Galerie". */
export function alertLabel(key: string): string {
  const colon = key.indexOf(':')
  const type = colon === -1 ? key : key.slice(0, colon)
  const value = colon === -1 ? '' : key.slice(colon + 1)
  switch (type) {
    case 'silent': return 'Kein Lebenszeichen'
    case 'check': return `Ampel rot: ${checkLabel(value)}`
    case 'event': return codeLabel(value)
    case 'release': return `Fehlerhäufung nach Release ${value}`
    default: return key
  }
}

/** Name of the company without the organisation, e.g. "kompanie-musterstadt". */
export function companyName(kompanie: string): string {
  const slash = kompanie.lastIndexOf('/')
  return slash === -1 ? kompanie : kompanie.slice(slash + 1)
}

export function variantLabel(variant: string): string {
  switch (variant) {
    case 'wordpress': return 'WordPress'
    case 'standalone': return 'eigenständig'
    default: return variant
  }
}

/** Byte-wise comparison like PHP's <=> on strings (not locale-aware). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
