import { TimeRepository } from '../../../lib/erp/timeEntries'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  await new TimeRepository(erp.pool).add(await readTimeEntry(event), erp.now())
  return { message: 'Erfasst.' }
})
