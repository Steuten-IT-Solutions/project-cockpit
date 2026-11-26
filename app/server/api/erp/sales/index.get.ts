import { SalesRepository } from '../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  return { documents: await new SalesRepository(erp.pool).list(), today: erp.today() }
})
