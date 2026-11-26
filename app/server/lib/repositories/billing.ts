import { eq } from 'drizzle-orm'
import type { Charge } from '#shared/lib/costs'
import { vercelBilling, vercelCharges } from '../../database/schema'
import type { Database } from '../db'

// vercel_billing (one row) and vercel_charges, like src/Vercel/BillingRepository.php.

export interface BillingState {
  periodFrom: string | null
  periodTo: string | null
  syncedAt: string | null
  error: string | null
  errorAt: string | null
}

export class BillingRepository {
  constructor(private readonly db: Database) {}

  async state(): Promise<BillingState | null> {
    const [row] = await this.db.select().from(vercelBilling).where(eq(vercelBilling.id, 1)).limit(1)
    if (row === undefined) return null
    const { id: _id, ...state } = row
    return state
  }

  async charges(): Promise<Charge[]> {
    const rows = await this.db.select().from(vercelCharges)
    return rows.map(r => ({
      service: r.service, category: r.category, project: r.project,
      billedCost: Number(r.billedCost), effectiveCost: Number(r.effectiveCost), currency: r.currency,
    }))
  }

  /** Replaces the stored charges with a new result in one transaction. */
  async replace(sums: Charge[], from: string, to: string, syncedAt: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(vercelCharges)
      for (const s of sums) {
        await tx.insert(vercelCharges).values({
          service: s.service, category: s.category, project: s.project,
          billedCost: s.billedCost.toFixed(6), effectiveCost: s.effectiveCost.toFixed(6), currency: s.currency,
        })
      }
      await tx.insert(vercelBilling).values({ id: 1, periodFrom: from, periodTo: to, syncedAt, error: null, errorAt: null })
        .onDuplicateKeyUpdate({ set: { periodFrom: from, periodTo: to, syncedAt, error: null, errorAt: null } })
    })
  }

  /** Records a failed sync; the last successful result stays. */
  async fail(error: string, at: string): Promise<void> {
    const message = [...error].slice(0, 255).join('')
    await this.db.insert(vercelBilling).values({ id: 1, error: message, errorAt: at })
      .onDuplicateKeyUpdate({ set: { error: message, errorAt: at } })
  }
}
