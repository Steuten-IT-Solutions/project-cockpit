import { SubscriptionRepository } from '../../../lib/erp/subscriptions'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new SubscriptionRepository(erp.pool)
  const id = idParam(event)
  if (await repository.find(id) === null) refuse('Der Eintrag existiert nicht mehr.')
  const { subscription, lines } = await readSubscription(event)
  await repository.save(id, subscription, lines, erp.now())
  return { message: `${subscription.name} gespeichert.` }
})
