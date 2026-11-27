import { MailFileRepository } from '../../../../../lib/erp/mailbox'

// An attachment from the mailbox, to look at or to enter it.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const file = await new MailFileRepository(useErp(event).pool).file(idParam(event))
  if (file === null) throw createError({ statusCode: 404, statusMessage: 'Die Datei existiert nicht.' })
  return sendFile(event, file.content, file.name, file.type, true)
})
