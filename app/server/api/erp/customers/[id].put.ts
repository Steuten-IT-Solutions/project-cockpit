import { customerFromBody } from '../../../lib/erp/forms'

// Changes apply to drafts and new invoices; finalized invoices keep the frozen address.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const id = idParam(event)
  if (await erp.master.customer(id) === null) refuse('Der Kunde existiert nicht mehr.')
  const projects = (await erp.master.projects()).map(p => p.id)
  const customer = customerFromBody(await readObject(event), projects)
  if (typeof customer === 'string') refuse(customer)
  await erp.master.updateCustomer(id, customer)
  return { message: `${customer.name} gespeichert.` }
})
