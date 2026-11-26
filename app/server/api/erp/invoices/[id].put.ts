import { InvoiceRepository } from '../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const draft = await readDraft(event)
  if (!await new InvoiceRepository(erp.pool).updateDraft(idParam(event), draft, erp.now())) {
    refuse('Nur Entwürfe können geändert werden.')
  }
  return { message: 'Entwurf gespeichert.' }
})
