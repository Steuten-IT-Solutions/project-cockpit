import { isoDate } from '#shared/lib/erp'
import { parseAmount } from '#shared/lib/costs'
import { IncomingRepository } from '../../../../lib/erp/incoming'

// Marks as paid on a date, or as open again (paidOn empty). "paidAmount" is the amount
// actually debited in euros, when the bank took a little more or less than the invoice.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const body = await readObject(event)
  const paidOn = body.paidOn === '' || body.paidOn === null || body.paidOn === undefined ? null : isoDate(body.paidOn)
  if (paidOn === null && body.paidOn) refuse('Das Datum ist ungültig.')
  const amountText = typeof body.paidAmount === 'string' ? body.paidAmount.trim() : ''
  const paidCents = amountText === '' ? null : parseAmount(amountText)
  if (paidCents === null && amountText !== '') refuse('Der abgebuchte Betrag muss eine Zahl mit höchstens zwei Nachkommastellen sein, z. B. 20,37.')
  if (paidCents === 0) refuse('Der abgebuchte Betrag darf nicht 0 sein.')
  if (!await new IncomingRepository(erp.pool).setPaid(idParam(event), paidOn, erp.now(), paidCents)) refuse('Verworfene Rechnungen können nicht bezahlt werden.')
  return { message: paidOn === null ? 'Wieder offen.' : 'Als bezahlt markiert.' }
})
