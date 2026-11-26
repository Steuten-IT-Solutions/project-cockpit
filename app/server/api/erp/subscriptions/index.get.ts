import { SubscriptionRepository } from '../../../lib/erp/subscriptions'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  return { subscriptions: await new SubscriptionRepository(erp.pool).list(), ...await editorData(event), today: erp.today() }
})
