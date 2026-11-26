import { supplierFromBody } from '../../../lib/erp/forms'
import { IncomingRepository } from '../../../lib/erp/incoming'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const repository = new IncomingRepository(useErp(event).pool)
  const id = idParam(event)
  if (await repository.supplier(id) === null) refuse('Der Lieferant existiert nicht mehr.')
  const supplier = supplierFromBody(await readObject(event))
  if (typeof supplier === 'string') refuse(supplier)
  await repository.updateSupplier(id, supplier)
  return { message: `${supplier.name} gespeichert.` }
})
