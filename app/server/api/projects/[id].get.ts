import type { ProjectPage } from '#shared/types/cockpit'
import { CostRepository } from '../../lib/repositories/costs'
import { NoteRepository, ProjectRepository } from '../../lib/repositories/projects'
import { AlertRepository, alertsByInstallation, InstallationRepository, reportsByRepository, StatusRepository } from '../../lib/repositories/status'
import { VercelRepository, vercelByRepository } from '../../lib/repositories/vercel'

// One project with its note (GET /project?id= of the PHP cockpit).
export default defineEventHandler(async (event): Promise<ProjectPage> => {
  await requireUser(event)
  const { db } = useCockpit(event)
  const project = await new ProjectRepository(db).find(idParam(event))
  if (project === null) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  const ref = [{ id: project.id, fullName: project.fullName }]
  const [vercel, reports, installations, openAlerts, costs, history] = await Promise.all([
    new VercelRepository(db).all(),
    new StatusRepository(db).all(),
    new InstallationRepository(db).all(),
    new AlertRepository(db).open(),
    new CostRepository(db).all(project.id),
    new NoteRepository(db).history(project.id, 20),
  ])
  const own = installations.filter(i => i.kompanie.toLowerCase() === project.fullName.toLowerCase())
  // Format 1 rows of a variant that already sends format 2 are outdated.
  const variants = new Set(own.map(i => i.variant))
  return {
    now: Math.floor(Date.now() / 1000),
    project,
    vercel: vercelByRepository(vercel, ref)[project.id] ?? [],
    reports: (reportsByRepository(reports, ref)[project.id] ?? []).filter(r => !variants.has(r.variant)),
    installations: own,
    alertsByInstallation: alertsByInstallation(openAlerts),
    costs,
    history,
  }
})
