import { SubscriptionRepository } from '../../../lib/erp/subscriptions'

// Removes the plan only; invoices created from it stay.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!await new SubscriptionRepository(useErp(event).pool).delete(idParam(event))) refuse('Der Eintrag existiert nicht mehr.')
  return { message: 'Gelöscht. Bereits erstellte Rechnungen bleiben.' }
})
