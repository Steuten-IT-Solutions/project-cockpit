import { MailFileRepository } from '../../../../../lib/erp/mailbox'

// An ignored file (by hand or skipped on fetching) goes back on the list to be entered.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  if (!await new MailFileRepository(erp.pool).restore(idParam(event), erp.now())) refuse('Die Datei ist nicht ignoriert.')
  return { message: 'Wiederhergestellt.' }
})
