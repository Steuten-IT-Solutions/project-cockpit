import { SalesRepository } from '../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const { kind, ...input } = await readSales(event)
  const id = await new SalesRepository(erp.pool).create(kind, input, erp.now())
  return { id, message: 'Entwurf gespeichert.' }
})
