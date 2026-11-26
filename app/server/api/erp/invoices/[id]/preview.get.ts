import { InvoiceRepository } from '../../../../lib/erp/invoices'

// The draft as PDF with the watermark ENTWURF, shown in the browser.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const pdf = await erpAction(() => new InvoiceRepository(erp.pool).preview(idParam(event), erp.engine, erp.master, erp.today()))
  return sendFile(event, pdf, 'Entwurf.pdf', 'application/pdf', true)
})
