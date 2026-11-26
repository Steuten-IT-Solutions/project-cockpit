import { InvoiceRepository } from '../../../../lib/erp/invoices'
import { SubscriptionRepository } from '../../../../lib/erp/subscriptions'

// Creates the draft for the next period now, without waiting for its date.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const invoiceId = await new SubscriptionRepository(erp.pool).bill(idParam(event), new InvoiceRepository(erp.pool), erp.now())
  if (invoiceId === null) refuse('Der Eintrag ist pausiert oder beendet.')
  return { invoiceId, message: 'Rechnungsentwurf angelegt.' }
})
