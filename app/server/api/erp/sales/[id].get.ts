import { SalesRepository } from '../../../lib/erp/sales'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const document = await new SalesRepository(erp.pool).find(idParam(event))
  if (document === null) throw createError({ statusCode: 404, statusMessage: 'Das Dokument existiert nicht.' })
  return { document, ...await editorData(event), today: erp.today() }
})
