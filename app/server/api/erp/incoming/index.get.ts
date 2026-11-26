import { IncomingRepository } from '../../../lib/erp/incoming'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new IncomingRepository(erp.pool)
  const [invoices, suppliers, projects] = await Promise.all([repository.list(), repository.suppliers(), erp.master.projects()])
  return { invoices, suppliers, projects, today: erp.today() }
})
