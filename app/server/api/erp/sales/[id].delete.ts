import { SalesRepository } from '../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!await new SalesRepository(useErp(event).pool).delete(idParam(event))) refuse('Nur Entwürfe können gelöscht werden.')
  return { message: 'Entwurf gelöscht.' }
})
