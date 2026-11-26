import { customerFromBody } from '../../../lib/erp/forms'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const projects = (await erp.master.projects()).map(p => p.id)
  const customer = customerFromBody(await readObject(event), projects)
  if (typeof customer === 'string') refuse(customer)
  const id = await erp.master.addCustomer(customer, erp.now())
  return { id, message: `${customer.name} angelegt.` }
})
