import { EngineInputError } from '../../../lib/erp/engine'
import { IncomingRepository } from '../../../lib/erp/incoming'

// One incoming invoice. For an e-invoice the XML is read again, so its positions can be
// shown in readable form (the XML is what counts, not a picture in the PDF).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new IncomingRepository(erp.pool)
  const invoice = await repository.find(idParam(event))
  if (invoice === null) throw createError({ statusCode: 404, statusMessage: 'Die Eingangsrechnung existiert nicht.' })
  let parsed = null
  if (invoice.format !== 'other') {
    const file = await repository.file(invoice.id)
    try {
      parsed = await erp.engine.read(file!.content)
    }
    catch (e) {
      if (!(e instanceof EngineInputError)) throw e
    }
  }
  const [supplier, otherIbans, projects, all] = await Promise.all([repository.supplier(invoice.supplierId), repository.otherIbans(invoice), erp.master.projects(), repository.list()])
  // The supplier's other documents: a credit note can be linked to one of its invoices,
  // and an invoice shows the credit notes that refer to it.
  const siblings = all.filter(i => i.supplierId === invoice.supplierId && i.id !== invoice.id)
  return { invoice, supplier, otherIbans, parsed, projects, siblings, today: erp.today() }
})
