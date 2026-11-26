import { nextReminder } from '../../../../lib/erp/dunning'
import { InvoiceRepository } from '../../../../lib/erp/invoices'
import { recipient, sendDocument } from '../../../../lib/erp/sending'

// Sends the next reminder by e-mail with the invoice attached and records it.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new InvoiceRepository(erp.pool)
  const id = idParam(event)
  const body = await readObject(event)
  return erpAction(async () => {
    const invoice = await repository.find(id, erp.today())
    if (invoice === null) refuse('Die Rechnung existiert nicht.')
    const settings = await erp.master.settings()
    const reminder = nextReminder(invoice, settings, erp.today())
    const to = recipient(body.to, invoice.customerEmail)
    const file = await repository.file(id, 'pdf')
    await sendDocument(erp.mail, settings, to, reminder.subject, reminder.text, [{ filename: `${invoice.number}.pdf`, contentType: 'application/pdf', content: file!.content }])
    await repository.addReminder(id, { level: reminder.level, sentOn: erp.today(), newDueDate: reminder.newDueDate, recipient: to, body: reminder.text }, erp.now())
    await repository.event(erp.pool, id, 'reminded', `${reminder.title} an ${to}`, erp.now())
    return { message: `${reminder.title} an ${to} gesendet.` }
  })
})
