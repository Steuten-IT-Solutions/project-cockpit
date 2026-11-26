import { SalesRepository } from '../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const { kind: _kind, ...input } = await readSales(event)
  if (!await new SalesRepository(erp.pool).update(idParam(event), input, erp.now())) refuse('Nur Entwürfe können geändert werden.')
  return { message: 'Entwurf gespeichert.' }
})
