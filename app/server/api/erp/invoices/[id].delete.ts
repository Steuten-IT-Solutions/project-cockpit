import { InvoiceRepository } from '../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!await new InvoiceRepository(useErp(event).pool).deleteDraft(idParam(event))) {
    refuse('Nur Entwürfe können gelöscht werden. Eine festgeschriebene Rechnung wird storniert.')
  }
  return { message: 'Entwurf gelöscht.' }
})
