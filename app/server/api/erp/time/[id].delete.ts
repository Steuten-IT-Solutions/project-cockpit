import { TimeRepository } from '../../../lib/erp/timeEntries'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!await new TimeRepository(useErp(event).pool).delete(idParam(event))) refuse('Abgerechnete Einträge lassen sich nicht löschen.')
  return { message: 'Gelöscht.' }
})
