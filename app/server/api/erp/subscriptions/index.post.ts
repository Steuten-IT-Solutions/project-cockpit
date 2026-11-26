import { SubscriptionRepository } from '../../../lib/erp/subscriptions'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const { subscription, lines } = await readSubscription(event)
  const id = await new SubscriptionRepository(erp.pool).save(null, subscription, lines, erp.now())
  return { id, message: `${subscription.name} angelegt.` }
})
