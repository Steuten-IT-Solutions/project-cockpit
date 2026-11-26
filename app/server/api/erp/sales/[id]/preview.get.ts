import { SalesRepository } from '../../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const pdf = await erpAction(() => new SalesRepository(erp.pool).preview(idParam(event), erp.engine, erp.master, erp.today()))
  return sendFile(event, pdf, 'Entwurf.pdf', 'application/pdf', true)
})
