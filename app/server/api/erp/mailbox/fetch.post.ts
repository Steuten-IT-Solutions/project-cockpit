import { fetchIncomingMail, fetchSummary, MailboxSettingsRepository } from '../../../lib/erp/mailbox'

// "Jetzt abrufen": fetches the mailbox at once instead of waiting for the background job.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const result = await erpAction(() => fetchIncomingMail(erp.pool, erp.crypto, erp.engine, erp.now()))
  if (result === null) {
    const configured = (await new MailboxSettingsRepository(erp.pool, erp.crypto).access()) !== null
    refuse(configured ? 'Das Postfach wird gerade schon abgerufen. Bitte versuche es gleich noch einmal.' : 'Bitte richte zuerst das Postfach ein.')
  }
  return { ...result, message: fetchSummary(result) }
})
