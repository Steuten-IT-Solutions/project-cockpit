import { InvoiceRepository } from '../../../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  if (!await new InvoiceRepository(erp.pool).deletePayment(idParam(event), idParam(event, 'paymentId'), erp.now())) {
    refuse('Die Zahlung existiert nicht mehr.')
  }
  return { message: 'Zahlung gelöscht.' }
})
