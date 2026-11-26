import { ProjectRepository } from '../../lib/repositories/projects'
import { BillingRepository } from '../../lib/repositories/billing'
import { CostRepository } from '../../lib/repositories/costs'

// The costs page: fixed costs entered by hand and the month's Vercel charges.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { db, config } = useCockpit(event)
  const billing = new BillingRepository(db)
  const [costs, projects, state, charges] = await Promise.all([
    new CostRepository(db).all(),
    new ProjectRepository(db).all(),
    billing.state(),
    billing.charges(),
  ])
  return {
    costs,
    projects: projects.map(p => ({ id: p.id, name: p.name })),
    vercelConfigured: config.vercel !== null && config.vercel.billing,
    billing: state,
    charges,
  }
})
