import { catalogFromBody } from '../../../lib/erp/forms'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const item = catalogFromBody(await readObject(event), (await erp.master.settings())?.smallBusiness ?? true)
  if (typeof item === 'string') refuse(item)
  await erp.master.addCatalogItem(item, erp.now())
  return { message: `${item.name} angelegt.` }
})
