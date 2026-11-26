import { InvoiceRepository } from '../../../../lib/erp/invoices'

// The PDF exactly as issued (ZUGFeRD, with the XML inside).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const file = await new InvoiceRepository(useErp(event).pool).file(idParam(event), 'pdf')
  if (file === null) throw createError({ statusCode: 404, statusMessage: 'Für Entwürfe gibt es noch keine Datei.' })
  return sendFile(event, file.content, `${file.number}.pdf`, 'application/pdf', getQuery(event).download === undefined)
})
