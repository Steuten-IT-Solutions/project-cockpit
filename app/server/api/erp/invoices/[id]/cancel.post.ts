import { cleanText } from '#shared/lib/erp'
import { InvoiceRepository } from '../../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const reason = cleanText((await readObject(event)).reason, 300)
  const result = await erpAction(() => new InvoiceRepository(erp.pool).cancel(idParam(event), reason, erp.engine, erp.master, erp.today(), erp.now()))
  return { ...result, message: `Stornorechnung ${result.number} erstellt.` }
})
