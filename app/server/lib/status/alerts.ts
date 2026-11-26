import type { AlertRepository, InstallationRepository } from '../repositories/status'
import { utc } from '../time'
import type { Notifier } from './notifier'
import { diffAlerts, EVENT_HOLD, wantedAlerts } from './rules'

// Evaluates the status reports and notifies (src/Status/Alerts.php): opens alerts for new
// problems, resolves those that disappeared, then sends one message for everything not yet
// notified. No repeats while an alert stays open.

/** Resolved alerts and the history are kept this long. */
export const KEEP_DAYS = 90

export async function evaluateAlerts(installations: InstallationRepository, alerts: AlertRepository, notifier: Notifier | null, now: number) {
  const at = utc(0, now * 1000)
  const wanted = wantedAlerts(await installations.all(), await installations.eventsSince(utc(-EVENT_HOLD, now * 1000)), now)
  const diff = diffAlerts(wanted, await alerts.open())
  for (const alert of diff.open) await alerts.openAlert(alert, at)
  for (const touch of diff.touch) await alerts.touch(touch.id, touch.detail, at)
  for (const id of diff.resolve) await alerts.resolve(id, at)

  let notified = false
  const pending = await alerts.unnotified()
  if (pending.length > 0) {
    // Marked as notified even if a channel failed or none is set up: otherwise every run
    // (or the first run after setting up e-mail) would send everything again.
    notified = (await notifier?.send(pending, now)) ?? false
    await alerts.markNotified(pending.map(a => a.id), at)
  }
  await alerts.prune(utc(-KEEP_DAYS * 86400, now * 1000))
  return { opened: diff.open.length, resolved: diff.resolve.length, notified }
}
