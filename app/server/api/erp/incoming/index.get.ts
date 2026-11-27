import { IncomingRepository } from '../../../lib/erp/incoming'
import { MailboxSettingsRepository, MailFileRepository } from '../../../lib/erp/mailbox'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new IncomingRepository(erp.pool)
  const [invoices, suppliers, projects, mailFiles, mailbox] = await Promise.all([repository.list(), repository.suppliers(), erp.master.projects(),
    new MailFileRepository(erp.pool).waiting(), new MailboxSettingsRepository(erp.pool, erp.crypto).settings()])
  return { invoices, suppliers, projects, mailFiles, mailbox: mailbox.user, today: erp.today() }
})
