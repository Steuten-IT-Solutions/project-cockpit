import { cleanText, linesFromForm } from '#shared/lib/erp'
import { InvoiceRepository } from '../../../../lib/erp/invoices'

// A Rechnungskorrektur: credits the positions sent (taken from the invoice, usually with
// a smaller quantity or price). The lines are checked like any other, then against the
// invoice in InvoiceRepository.correct().
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const body = await readObject(event)
  const reason = cleanText(body.reason, 300)
  // The tax treatment is the invoice's own; correct() refuses VAT for a small business.
  const lines = linesFromForm(body.lines, false)
  if (typeof lines === 'string') refuse(lines)
  const result = await erpAction(() => new InvoiceRepository(erp.pool).correct(idParam(event), lines, reason, erp.engine, erp.master, erp.today(), erp.now()))
  return { ...result, message: `Rechnungskorrektur ${result.number} erstellt.` }
})
