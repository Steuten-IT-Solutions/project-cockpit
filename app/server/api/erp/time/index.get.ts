import { addDays } from '#shared/lib/erp'
import { TimeRepository } from '../../../lib/erp/timeEntries'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new TimeRepository(erp.pool)
  const [entries, orders] = await Promise.all([repository.list(addDays(erp.today(), -365)), repository.orders()])
  return { entries, orders, ...await editorData(event), today: erp.today() }
})
