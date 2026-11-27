import { incomingFromBody } from '../../../lib/erp/forms'
import { IncomingRepository } from '../../../lib/erp/incoming'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const values = incomingFromBody(await readObject(event), (await erp.master.projects()).map(p => p.id))
  if (typeof values === 'string') refuse(values)
  if (!await erpAction(() => new IncomingRepository(erp.pool).update(idParam(event), values, erp.now()))) refuse('Verworfene Rechnungen können nicht geändert werden.')
  return { message: 'Gespeichert.' }
})
