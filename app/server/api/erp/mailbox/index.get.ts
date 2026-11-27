import { MailboxSettingsRepository } from '../../../lib/erp/mailbox'

// The mailbox for incoming invoices as shown on the settings page (without the password).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  return new MailboxSettingsRepository(erp.pool, erp.crypto).settings()
})
