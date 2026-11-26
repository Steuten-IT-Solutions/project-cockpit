import { InvoiceRepository } from '../../../lib/erp/invoices'

// Checks the stored files and the hash chain of all finalized invoices.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return new InvoiceRepository(useErp(event).pool).verify()
})
