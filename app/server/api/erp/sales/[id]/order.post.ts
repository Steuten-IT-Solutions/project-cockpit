import { SalesRepository } from '../../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const id = await erpAction(() => new SalesRepository(erp.pool).orderFromQuote(idParam(event), erp.today(), erp.now()))
  return { id, message: 'Entwurf der Auftragsbestätigung angelegt.' }
})
