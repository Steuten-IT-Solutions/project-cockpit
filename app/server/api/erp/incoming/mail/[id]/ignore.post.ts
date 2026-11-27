import { MailFileRepository } from '../../../../../lib/erp/mailbox'

// Not an invoice (e.g. terms and conditions attached to an order): removed from the list.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  if (!await new MailFileRepository(erp.pool).ignore(idParam(event), erp.now())) refuse('Die Datei wartet nicht mehr auf Erfassung.')
  return { message: 'Ignoriert.' }
})
