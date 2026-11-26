import { CostRepository } from '../../lib/repositories/costs'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const deleted = await new CostRepository(useCockpit(event).db).delete(idParam(event))
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Der Eintrag existiert nicht mehr.' })
  }
  return { message: 'Kosten gelöscht.' }
})
