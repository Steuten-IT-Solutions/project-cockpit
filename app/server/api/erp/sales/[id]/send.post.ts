import { mailText } from '#shared/lib/erp'
import { SalesRepository } from '../../../../lib/erp/sales'
import { recipient, sendDocument } from '../../../../lib/erp/sending'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new SalesRepository(erp.pool)
  const id = idParam(event)
  const body = await readObject(event)
  return erpAction(async () => {
    const doc = await repository.find(id)
    const file = await repository.file(id)
    if (doc === null || file === null) refuse('Bitte stelle das Dokument zuerst aus.')
    const to = recipient(body.to, doc.customerEmail)
    const settings = await erp.master.settings()
    const label = doc.kind === 'quote' ? 'Angebot' : 'Auftragsbestätigung'
    const text = mailText(settings?.mailText ?? null, { document: label, number: file.number, grossCents: doc.grossCents, dueDate: doc.validUntil, sender: settings?.contactName ?? settings?.name ?? '' })
    await sendDocument(erp.mail, settings, to, `${label} ${file.number} – ${settings?.name ?? ''}`, text, [{ filename: `${file.number}.pdf`, contentType: 'application/pdf', content: file.content }])
    return { message: `${label} ${file.number} an ${to} gesendet.` }
  })
})
