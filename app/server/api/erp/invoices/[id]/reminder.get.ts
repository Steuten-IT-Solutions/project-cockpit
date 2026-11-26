import { nextReminder } from '../../../../lib/erp/dunning'
import { InvoiceRepository } from '../../../../lib/erp/invoices'

// The next reminder as it would be sent, for the confirmation on the page.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const invoice = await new InvoiceRepository(erp.pool).find(idParam(event), erp.today())
  if (invoice === null) throw createError({ statusCode: 404, statusMessage: 'Die Rechnung existiert nicht.' })
  return erpAction(async () => ({ ...nextReminder(invoice, await erp.master.settings(), erp.today()), to: invoice.customerEmail }))
})
