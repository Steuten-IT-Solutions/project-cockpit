import { IncomingRepository } from '../../../../lib/erp/incoming'

// The file exactly as received. XML is offered as a download; PDF and images open in the browser.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const file = await new IncomingRepository(useErp(event).pool).file(idParam(event))
  if (file === null) throw createError({ statusCode: 404, statusMessage: 'Die Datei existiert nicht.' })
  return sendFile(event, file.content, file.name, file.type, file.type !== 'application/xml')
})
