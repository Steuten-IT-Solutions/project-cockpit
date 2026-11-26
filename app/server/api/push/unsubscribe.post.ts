import { PushSubscriptionRepository } from '../../lib/repositories/push'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const endpoint = bodyString(await readBody(event), 'endpoint')
  if (endpoint !== '') {
    await new PushSubscriptionRepository(useCockpit(event).db).remove(endpoint)
  }
  setResponseStatus(event, 204)
  return null
})
