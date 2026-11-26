import { AlertRepository } from '../lib/repositories/status'
import { PushSubscriptionRepository } from '../lib/repositories/push'
import { utc } from '../lib/time'

// The alerts page: open alerts, those resolved in the last 30 days, notification settings.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { db, config } = useCockpit(event)
  const [alerts, subscriptions, push] = await Promise.all([
    new AlertRepository(db).recent(utc(-30 * 86400), 200),
    config.push !== null ? new PushSubscriptionRepository(db).all() : Promise.resolve([]),
    webPush(event),
  ])
  return {
    alerts,
    statusReceiver: config.statusReports !== null,
    emailTo: config.alerts?.email ?? null,
    pushConfigured: config.push !== null,
    pushKey: push?.publicKey ?? null,
    // The endpoint identifies a device at its push service; the page needs only the count and errors.
    subscriptions: subscriptions.map(s => ({ createdAt: s.createdAt, lastError: s.lastError })),
  }
})
