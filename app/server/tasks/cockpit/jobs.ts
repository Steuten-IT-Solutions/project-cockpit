import { runJobs } from '../../lib/jobs/runner'

// The background jobs every 15 minutes (nuxt.config.ts, scheduledTasks), replacing the
// PHP cron job cron/run.php. Nitro runs it inside the cockpit's Node process.
export default defineTask({
  meta: { name: 'cockpit:jobs', description: 'GitHub, Vercel, releases, alerts and bug reports' },
  async run() {
    if (!useRuntimeConfig().scheduledJobs) {
      return { result: 'disabled' }
    }
    try {
      const result = await runJobs(jobContext())
      if (result === null) {
        console.info('[cockpit jobs] another run is in progress')
        return { result: 'locked' }
      }
      console.info(`[cockpit jobs] ${result.status} ${result.message ?? ''}`)
      return { result: result.status }
    }
    catch (e) {
      // E.g. the database is unreachable or a migration failed; the next run tries again.
      console.error('[cockpit jobs] failed:', e)
      return { result: 'error' }
    }
  },
})
