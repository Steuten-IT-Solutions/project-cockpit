import { IncomingRepository } from '../../../lib/erp/incoming'
import { MailboxSettingsRepository, MailFileRepository } from '../../../lib/erp/mailbox'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const repository = new IncomingRepository(erp.pool)
  const mailFiles = new MailFileRepository(erp.pool)
  const [invoices, suppliers, projects, waiting, ignoredMailFiles, mailbox] = await Promise.all([repository.list(), repository.suppliers(), erp.master.projects(),
    mailFiles.waiting(), mailFiles.ignored(), new MailboxSettingsRepository(erp.pool, erp.crypto).settings()])
  return { invoices, suppliers, projects, mailFiles: waiting, ignoredMailFiles, mailbox: mailbox.user, today: erp.today() }
})
