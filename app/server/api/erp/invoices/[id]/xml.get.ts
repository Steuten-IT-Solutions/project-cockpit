import { InvoiceRepository } from '../../../../lib/erp/invoices'

// The XML alone (CII), e.g. for a customer's portal that wants the bare e-invoice.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const file = await new InvoiceRepository(useErp(event).pool).file(idParam(event), 'xml')
  if (file === null) throw createError({ statusCode: 404, statusMessage: 'Für Entwürfe gibt es noch keine Datei.' })
  return sendFile(event, file.content, `${file.number}.xml`, 'application/xml')
})
