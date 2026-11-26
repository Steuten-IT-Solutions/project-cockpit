import { NoteRepository, ProjectRepository } from '../../../lib/repositories/projects'

// Saves the project's note as a new version (POST /project/note of the PHP cockpit).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { db } = useCockpit(event)
  const project = await new ProjectRepository(db).find(idParam(event))
  if (project === null) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  const body = bodyString(await readBody(event), 'body')
  if ([...body].length > NoteRepository.MAX_LENGTH) {
    throw createError({ statusCode: 422, statusMessage: 'Die Notiz ist zu lang und wurde nicht gespeichert.' })
  }
  const saved = await new NoteRepository(db).save(project.id, body, user.id)
  return { message: saved ? 'Notiz gespeichert.' : 'Keine Änderung – nichts gespeichert.' }
})
