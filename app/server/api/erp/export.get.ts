import { isoDate } from '#shared/lib/erp'
import { InvoiceRepository } from '../../lib/erp/invoices'
import { exportArchive } from '../../lib/erp/reports'

// ZIP of all documents and lists of a period: /api/erp/export?from=2026-01-01&to=2026-12-31
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const query = getQuery(event)
  const from = isoDate(query.from)
  const to = isoDate(query.to)
  if (from === null || to === null || from > to) refuse('Bitte einen gültigen Zeitraum wählen.')
  const archive = await exportArchive(erp.pool, new InvoiceRepository(erp.pool), from, to, new Date())
  return sendFile(event, archive, `cockpit-export_${from}_${to}.zip`, 'application/zip')
})
