import { idField, incomingFromBody } from '../../../lib/erp/forms'
import { IncomingRepository, type ManualEntry } from '../../../lib/erp/incoming'
import { MailFileRepository } from '../../../lib/erp/mailbox'
import { INCOMING_CATEGORIES } from '#shared/lib/erp'

// Upload of an incoming invoice as multipart form: the file ("file") and, for files
// without e-invoice data, the fields typed in by hand. "mailFileId" names the attachment
// from the mailbox the file was taken from; it is then marked as entered.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const parts = await readMultipartFormData(event) ?? []
  const file = parts.find(p => p.name === 'file' && p.filename !== undefined)
  if (file === undefined || file.data.length === 0) refuse('Bitte eine Datei wählen.')
  if (file.data.length > 7_500_000) refuse('Die Datei darf höchstens 7,5 MB groß sein.')
  const body: Record<string, string> = {}
  for (const part of parts) {
    if (part.name !== undefined && part.name !== 'file') body[part.name] = part.data.toString('utf8')
  }
  const category = body.category ?? 'other'
  if (!(category in INCOMING_CATEGORIES)) refuse('Bitte eine Kategorie wählen.')
  const projectIds = (await erp.master.projects()).map(p => p.id)
  const projectId = idField(body.projectId)
  if (projectId === 'invalid' || (projectId !== null && !projectIds.includes(projectId))) refuse('Unbekanntes Projekt.')

  // The typed-in fields count only when the file is no e-invoice; until then a
  // validation message is kept and shown only if they are needed.
  let manual: ManualEntry | string | null = null
  if ((body.number ?? '') !== '' || (body.net ?? '') !== '') {
    const fields = incomingFromBody({ ...body, category }, projectIds)
    const supplierId = idField(body.supplierId)
    manual = typeof fields === 'string'
      ? fields
      : { supplierId: supplierId === 'invalid' ? null : supplierId, supplierName: (body.supplierName ?? '').trim().slice(0, 100) || null, fields }
  }
  const result = await erpAction(() => new IncomingRepository(erp.pool).upload({ name: file.filename ?? 'rechnung', data: file.data }, manual, category, projectId, erp.engine, erp.now()))
  const mailFileId = idField(body.mailFileId)
  if (typeof mailFileId === 'number') await new MailFileRepository(erp.pool).booked(mailFileId, result.id, erp.now())
  const read = result.format === 'other' ? 'Erfasst.' : 'E-Rechnung gelesen und erfasst.'
  return { ...result, message: read }
})
