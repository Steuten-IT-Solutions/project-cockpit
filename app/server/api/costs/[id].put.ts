import { CostRepository } from '../../lib/repositories/costs'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const repository = new CostRepository(useCockpit(event).db)
  const id = idParam(event)
  if (await repository.find(id) === null) {
    throw createError({ statusCode: 404, statusMessage: 'Der Eintrag existiert nicht mehr.' })
  }
  const cost = await readCost(event)
  await repository.update(id, cost)
  return { message: `${cost.name} gespeichert.` }
})
