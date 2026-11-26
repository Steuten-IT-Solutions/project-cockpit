import { InvoiceRepository } from '../../../../lib/erp/invoices'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const number = await erpAction(() => new InvoiceRepository(erp.pool).finalize(idParam(event), erp.engine, erp.master, erp.today(), erp.now()))
  return { number, message: `Rechnung ${number} festgeschrieben.` }
})
