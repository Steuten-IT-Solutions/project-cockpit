import { asc, eq, sql } from 'drizzle-orm'
import { pushSubscriptions } from '../../database/schema'
import type { Database } from '../db'
import { utc } from '../time'

// Web push subscriptions: only the endpoint is stored, pushes carry no payload
// (src/Notify/PushSubscriptionRepository.php).

export interface PushSubscription { endpoint: string, createdAt: string, lastError: string | null }

export class PushSubscriptionRepository {
  constructor(private readonly db: Database) {}

  async add(userId: number, endpoint: string): Promise<void> {
    await this.db.insert(pushSubscriptions).values({ userId, endpoint, createdAt: utc() })
      .onDuplicateKeyUpdate({ set: { userId: sql`VALUES(user_id)`, lastError: null } })
  }

  async remove(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  }

  async markError(endpoint: string, error: string): Promise<void> {
    await this.db.update(pushSubscriptions).set({ lastError: [...error].slice(0, 255).join('') }).where(eq(pushSubscriptions.endpoint, endpoint))
  }

  async all(): Promise<PushSubscription[]> {
    return this.db.select({ endpoint: pushSubscriptions.endpoint, createdAt: pushSubscriptions.createdAt, lastError: pushSubscriptions.lastError })
      .from(pushSubscriptions).orderBy(asc(pushSubscriptions.createdAt))
  }
}
