import type { Dashboard } from '#shared/types/cockpit'
import { groupDashboard } from '../lib/dashboard'
import { currentVersion } from '../lib/migrator'
import { ProjectRepository } from '../lib/repositories/projects'
import { AlertRepository, InstallationRepository, StatusRepository } from '../lib/repositories/status'
import { SystemRepository } from '../lib/repositories/system'
import { VercelRepository } from '../lib/repositories/vercel'

// Everything the overview page shows (GET / of the PHP cockpit).
export default defineEventHandler(async (event): Promise<Dashboard> => {
  const user = await requireUser(event)
  const { db, pool, config, users } = useCockpit(event)
  const query = getQuery(event)

  const repository = new ProjectRepository(db)
  const all = await repository.all()
  const system = new SystemRepository(db)
  const [vercel, reports, installations, openAlerts, lastSync, lastCron, schemaVersion, recoveryLeft, events] = await Promise.all([
    new VercelRepository(db).all(),
    new StatusRepository(db).all(),
    new InstallationRepository(db).all(),
    new AlertRepository(db).open(),
    repository.lastSync(),
    system.lastCron(),
    currentVersion(pool),
    users.remainingRecoveryCodes(user.id),
    system.recentEvents(user.id, 8),
  ])
  const grouped = groupDashboard({ projects: all, vercel, reports, installations, openAlerts, showHidden: query.all === '1' })

  return {
    now: Math.floor(Date.now() / 1000),
    githubConfigured: config.github !== null,
    statusReceiver: config.statusReports !== null,
    // No row at all and never synced: the page says that data appears after the next run.
    projects: all.length === 0 && lastSync === null ? null : grouped.projects,
    hiddenCount: grouped.hiddenCount,
    lastSync,
    vercelByRepo: grouped.vercelByRepo,
    vercelUnmatched: grouped.vercelUnmatched,
    reports: grouped.reports,
    reportsByRepo: grouped.reportsByRepo,
    reportProject: grouped.reportProject,
    installations,
    installationsByRepo: grouped.installationsByRepo,
    openAlerts,
    releaseByRepo: grouped.releaseByRepo,
    system: { runtime: `Node ${process.versions.node}`, schemaVersion, lastCron, recoveryLeft, events },
  }
})
