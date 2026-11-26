import { ProjectRepository } from '../../../lib/repositories/projects'

// Hides a project on the overview or shows it again (POST /project/visibility).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { db } = useCockpit(event)
  const repository = new ProjectRepository(db)
  const project = await repository.find(idParam(event))
  if (project === null) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  const hidden = (await readBody<{ hidden?: unknown }>(event))?.hidden === true
  await repository.setHidden(project.id, hidden)
  return { message: hidden ? `${project.name} ausgeblendet.` : `${project.name} wird wieder angezeigt.` }
})
