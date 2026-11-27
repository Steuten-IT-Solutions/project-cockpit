import { mailText } from '#shared/lib/erp'
import { InvoiceRepository } from '../../../../lib/erp/invoices'
import { recipient, sendDocument } from '../../../../lib/erp/sending'

// Sends the issued PDF (ZUGFeRD: the XML is inside, so one attachment is the whole
// e-invoice; a second XML file could be booked twice by the customer's software).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new InvoiceRepository(erp.pool)
  const id = idParam(event)
  const body = await readObject(event)
  return erpAction(async () => {
    const invoice = await repository.find(id, erp.today())
    if (invoice === null) refuse('Die Rechnung existiert nicht.')
    const file = await repository.file(id, 'pdf')
    if (invoice.status !== 'final' || file === null) refuse('Bitte schreibe die Rechnung zuerst fest.')
    const to = recipient(body.to, invoice.customerEmail)
    const settings = await erp.master.settings()
    const document = invoice.type === '381' ? 'Stornorechnung' : 'Rechnung'
    const text = mailText(settings?.mailText ?? null, { document, number: file.number, grossCents: invoice.grossCents, dueDate: invoice.dueDate, sender: settings?.contactName ?? settings?.name ?? '' })
    await sendDocument(erp.mail, settings, invoice.type === '381' ? 'cancellation' : 'invoice', to, `${document} ${file.number} – ${settings?.name ?? ''}`, text, [{ filename: `${file.number}.pdf`, contentType: 'application/pdf', content: file.content }])
    await repository.event(erp.pool, id, 'sent', to, erp.now())
    return { message: `${document} ${file.number} an ${to} gesendet.` }
  })
})
