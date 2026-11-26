import { SalesRepository } from '../../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const number = await erpAction(() => new SalesRepository(erp.pool).issue(idParam(event), erp.engine, erp.master, erp.today(), erp.now()))
  return { number, message: `${number} ausgestellt.` }
})
