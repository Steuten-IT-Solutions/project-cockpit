import { idField } from '../../../lib/erp/forms'
import { InvoiceRepository } from '../../../lib/erp/invoices'
import { TimeRepository } from '../../../lib/erp/timeEntries'

// Turns the selected entries into one draft invoice.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const raw = (await readObject(event)).ids
  const ids = Array.isArray(raw) ? raw.map(idField) : []
  if (ids.some(id => typeof id !== 'number')) refuse('Ungültige Auswahl.')
  const paymentDays = (await erp.master.settings())?.paymentDays ?? 14
  const invoiceId = await erpAction(() => new TimeRepository(erp.pool).bill(ids as number[], new InvoiceRepository(erp.pool), paymentDays, erp.now()))
  return { invoiceId, message: 'Rechnungsentwurf angelegt.' }
})
