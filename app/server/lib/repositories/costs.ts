import { asc, eq } from 'drizzle-orm'
import type { Cost } from '#shared/types/cockpit'
import type { CostInput } from '#shared/lib/costs'
import { costs, projects } from '../../database/schema'
import type { Database } from '../db'

// costs, like src/Costs/CostRepository.php.

export class CostRepository {
  constructor(private readonly db: Database) {}

  async add(cost: CostInput, createdAt: string): Promise<void> {
    await this.db.insert(costs).values({ ...cost, createdAt })
  }

  /** Rewrites every field of an entry; its creation time stays. */
  async update(id: number, cost: CostInput): Promise<void> {
    await this.db.update(costs).set(cost).where(eq(costs.id, id))
  }

  async delete(id: number): Promise<boolean> {
    const [result] = await this.db.delete(costs).where(eq(costs.id, id))
    return result.affectedRows > 0
  }

  async find(id: number): Promise<Cost | null> {
    return (await this.select(id, null))[0] ?? null
  }

  async all(projectId: number | null = null): Promise<Cost[]> {
    return this.select(null, projectId)
  }

  private async select(id: number | null, projectId: number | null): Promise<Cost[]> {
    const query = this.db.select({
      id: costs.id, name: costs.name, provider: costs.provider, amountCents: costs.amountCents, currency: costs.currency,
      billingInterval: costs.billingInterval, projectId: costs.projectId, projectName: projects.name, note: costs.note, createdAt: costs.createdAt,
    }).from(costs).leftJoin(projects, eq(projects.id, costs.projectId))
    const where = id !== null ? eq(costs.id, id) : projectId !== null ? eq(costs.projectId, projectId) : undefined
    return query.where(where).orderBy(asc(costs.name), asc(costs.id))
  }
}
