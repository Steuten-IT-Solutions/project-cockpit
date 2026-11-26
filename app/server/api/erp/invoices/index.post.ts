import { InvoiceRepository } from '../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const draft = await readDraft(event)
  const id = await new InvoiceRepository(erp.pool).createDraft(draft, erp.now())
  return { id, message: 'Entwurf gespeichert.' }
})
