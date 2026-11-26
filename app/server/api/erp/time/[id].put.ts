import { TimeRepository } from '../../../lib/erp/timeEntries'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const entry = await readTimeEntry(event)
  if (!await new TimeRepository(erp.pool).update(idParam(event), entry, erp.now())) refuse('Abgerechnete Einträge lassen sich nicht mehr ändern.')
  return { message: 'Gespeichert.' }
})
