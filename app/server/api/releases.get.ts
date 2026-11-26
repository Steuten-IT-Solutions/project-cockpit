import type { ReleasesBox } from '#shared/types/cockpit'
import { releaseSummary } from '#shared/lib/releases'
import { ReleaseRepository } from '../lib/repositories/releases'

// The release box of the dashboard. The page reloads it every few seconds with the
// header X-Cockpit-Poll, so the polling alone does not keep the session alive.
export default defineEventHandler(async (event): Promise<ReleasesBox> => {
  await requireUser(event)
  const { db, config } = useCockpit(event)
  const summary = config.releases === null ? null : releaseSummary(await new ReleaseRepository(db).releases(200))
  return {
    repo: config.releases?.repo ?? null,
    webhook: (config.releases?.webhookSecret ?? null) !== null,
    summary,
    now: Math.floor(Date.now() / 1000),
  }
})
