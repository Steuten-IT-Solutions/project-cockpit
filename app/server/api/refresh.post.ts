import { runJobs, secondsSinceLastRun } from '../lib/jobs/runner'

// "Jetzt aktualisieren" on the dashboard: runs the background jobs now instead of waiting
// for the next scheduled run (App::refresh() in the PHP cockpit). At most once a minute.

const REFRESH_INTERVAL = 60

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const ctx = jobContext(event)
  const since = await secondsSinceLastRun(ctx.db, Math.floor(Date.now() / 1000))
  if (since !== null && since < REFRESH_INTERVAL) {
    return { status: 'wait', message: `Gerade erst aktualisiert. Bitte in ${REFRESH_INTERVAL - since} Sekunden erneut versuchen.` }
  }
  const result = await runJobs(ctx, 'Manuell gestartet')
  if (result === null) {
    return { status: 'locked', message: 'Es läuft gerade schon eine Aktualisierung. Bitte gleich neu laden.' }
  }
  return result.status === 'ok'
    ? { status: 'ok', message: 'Aktualisiert.' }
    : { status: 'warn', message: 'Aktualisiert, aber mit Warnung – Details unter „Letzter Cron-Lauf“.' }
})
