import { validEndpoint } from '../../lib/push'
import { PushSubscriptionRepository } from '../../lib/repositories/push'

// Stores this device's push subscription (sent by the alerts page).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const endpoint = bodyString(await readBody(event), 'endpoint')
  if (cockpitConfig(event).push === null || !validEndpoint(endpoint)) {
    throw createError({ statusCode: 400, statusMessage: 'Dieses Gerät kann keine Push-Nachrichten des Cockpits bekommen.' })
  }
  await new PushSubscriptionRepository(useCockpit(event).db).add(user.id, endpoint)
  setResponseStatus(event, 204)
  return null
})
