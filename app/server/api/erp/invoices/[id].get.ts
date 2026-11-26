import { InvoiceRepository } from '../../../lib/erp/invoices'

// One invoice with what its page needs to edit a draft (customers, projects, catalog).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const invoice = await new InvoiceRepository(erp.pool).find(idParam(event), erp.today())
  if (invoice === null) throw createError({ statusCode: 404, statusMessage: 'Die Rechnung existiert nicht.' })
  return { invoice, ...await editorData(event), today: erp.today() }
})
