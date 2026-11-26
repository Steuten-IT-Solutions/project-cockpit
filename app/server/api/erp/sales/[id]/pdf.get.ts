import { SalesRepository } from '../../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const file = await new SalesRepository(useErp(event).pool).file(idParam(event))
  if (file === null) throw createError({ statusCode: 404, statusMessage: 'Für Entwürfe gibt es noch keine Datei.' })
  return sendFile(event, file.content, `${file.number}.pdf`, 'application/pdf', true)
})
