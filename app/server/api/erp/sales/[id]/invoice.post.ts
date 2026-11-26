import { InvoiceRepository } from '../../../../lib/erp/invoices'
import { SalesRepository } from '../../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const paymentDays = (await erp.master.settings())?.paymentDays ?? 14
  const invoiceId = await erpAction(() => new SalesRepository(erp.pool).toInvoice(idParam(event), new InvoiceRepository(erp.pool), erp.today(), paymentDays, erp.now()))
  return { invoiceId, message: 'Rechnungsentwurf angelegt.' }
})
