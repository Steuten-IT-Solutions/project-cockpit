import { InvoiceRepository } from '../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  return { invoices: await new InvoiceRepository(erp.pool).list(erp.today()), today: erp.today() }
})
