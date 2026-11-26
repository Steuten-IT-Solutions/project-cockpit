import { yearReport } from '../../lib/erp/reports'

// Sums of one year: /api/erp/report?year=2026
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const current = Number(erp.today().slice(0, 4))
  const year = Number(getQuery(event).year ?? current)
  if (!Number.isInteger(year) || year < 2000 || year > current + 1) refuse('Ungültiges Jahr.')
  return { report: await yearReport(erp.pool, year), currentYear: current }
})
