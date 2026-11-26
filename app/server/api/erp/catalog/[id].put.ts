import { catalogFromBody } from '../../../lib/erp/forms'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const id = idParam(event)
  if (await erp.master.catalogItem(id) === null) refuse('Der Eintrag existiert nicht mehr.')
  const item = catalogFromBody(await readObject(event), (await erp.master.settings())?.smallBusiness ?? true)
  if (typeof item === 'string') refuse(item)
  await erp.master.updateCatalogItem(id, item)
  return { message: `${item.name} gespeichert.` }
})
