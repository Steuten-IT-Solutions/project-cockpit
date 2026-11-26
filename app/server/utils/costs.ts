import type { H3Event } from 'h3'
import { type CostForm, type CostInput, costFromForm } from '#shared/lib/costs'
import { ProjectRepository } from '../lib/repositories/projects'

/** The validated cost from the request body; 422 with the German message otherwise. */
export async function readCost(event: H3Event): Promise<CostInput> {
  const body = await readBody(event)
  const form: Partial<CostForm> = {}
  for (const key of ['name', 'provider', 'amount', 'currency', 'interval', 'project', 'note'] as const) {
    form[key] = bodyString(body, key)
  }
  const projectIds = (await new ProjectRepository(useCockpit(event).db).all()).map(p => p.id)
  const cost = costFromForm(form, projectIds)
  if (typeof cost === 'string') {
    throw createError({ statusCode: 422, statusMessage: cost })
  }
  return cost
}
