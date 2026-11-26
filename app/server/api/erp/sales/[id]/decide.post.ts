import { SalesRepository } from '../../../../lib/erp/sales'

// The customer's answer to a quote: accepted, rejected (or back to open).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const status = (await readObject(event)).status
  if (status !== 'accepted' && status !== 'rejected' && status !== 'sent') refuse('Unbekannter Status.')
  if (!await new SalesRepository(erp.pool).decide(idParam(event), status, erp.now())) refuse('Das geht nur bei ausgestellten Angeboten ohne Rechnung.')
  return { message: { accepted: 'Als angenommen markiert.', rejected: 'Als abgelehnt markiert.', sent: 'Wieder offen.' }[status] }
})
