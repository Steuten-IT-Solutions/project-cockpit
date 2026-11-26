import { CostRepository } from '../../lib/repositories/costs'
import { utc } from '../../lib/time'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const cost = await readCost(event)
  await new CostRepository(useCockpit(event).db).add(cost, utc())
  return { message: `${cost.name} hinzugefügt.` }
})
