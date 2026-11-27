import { migrateNow } from '../lib/jobs/runner'

// Applies new migrations as soon as the server starts. A deploy restarts the server with
// the new code; without this, the new code would query columns that only the next
// background run (up to 15 minutes later) adds, and pages would fail until then.
// Off where the background jobs are off (the integration tests migrate themselves).
export default defineNitroPlugin(() => {
  if (!useRuntimeConfig().scheduledJobs) return
  migrateNow(jobContext())
    .then((applied) => {
      if (applied === null) console.info('[cockpit] migrations: a background run holds the lock and migrates')
      else if (applied.length > 0) console.info(`[cockpit] migrations applied: ${applied.join(', ')}`)
    })
    // E.g. the database is not set up yet; the background jobs try again.
    .catch((e: unknown) => console.error('[cockpit] migrations failed at start:', e))
})
