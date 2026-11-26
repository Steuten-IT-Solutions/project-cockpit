import { isoDate } from '#shared/lib/erp'
import { IncomingRepository } from '../../../../lib/erp/incoming'

// Marks as paid on a date, or as open again (paidOn empty).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const body = await readObject(event)
  const paidOn = body.paidOn === '' || body.paidOn === null || body.paidOn === undefined ? null : isoDate(body.paidOn)
  if (paidOn === null && body.paidOn) refuse('Das Datum ist ungültig.')
  if (!await new IncomingRepository(erp.pool).setPaid(idParam(event), paidOn, erp.now())) refuse('Verworfene Rechnungen können nicht bezahlt werden.')
  return { message: paidOn === null ? 'Wieder offen.' : 'Als bezahlt markiert.' }
})
