import { parseAmount } from '#shared/lib/costs'
import { cleanText, isoDate } from '#shared/lib/erp'
import { InvoiceRepository } from '../../../../lib/erp/invoices'

// A payment received (bank statement). Part payments are fine; the invoice counts as
// paid once the payments cover the gross amount.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new InvoiceRepository(erp.pool)
  const id = idParam(event)
  const body = await readObject(event)
  const invoice = await repository.find(id, erp.today())
  if (invoice === null || invoice.status !== 'final' || invoice.type !== '380') refuse('Zahlungen gibt es nur zu festgeschriebenen Rechnungen.')
  const paidOn = isoDate(body.paidOn)
  if (paidOn === null) refuse('Bitte das Datum des Zahlungseingangs angeben.')
  const amountCents = parseAmount(String(body.amount ?? ''))
  if (amountCents === null || amountCents === 0) refuse('Der Betrag muss ein Betrag wie 49,90 sein.')
  await repository.addPayment(id, { paidOn, amountCents, note: cleanText(body.note, 255) }, erp.now())
  return { message: 'Zahlung erfasst.' }
})
