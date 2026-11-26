import { isEmail } from '#shared/lib/erp'
import type { CompanySettings } from '#shared/types/erp'
import { InvoiceError } from './invoices'
import type { Attachment, MailSender } from './mail'

// Sends a document (invoice, reminder, quote, order confirmation) to a customer from
// the address in the company settings. Postfix archives every outgoing mail (always_bcc
// to the mail archive), so the sent message is kept as GoBD asks.

/** The recipient: the address typed in the dialog or the customer's. */
export function recipient(typed: unknown, customerEmail: string | null): string {
  const to = typeof typed === 'string' && typed.trim() !== '' ? typed.trim() : customerEmail
  if (to === null) throw new InvoiceError('Der Kunde hat keine E-Mail-Adresse. Bitte trage eine ein.')
  if (!isEmail(to)) throw new InvoiceError('Die E-Mail-Adresse ist ungültig.')
  return to
}

export async function sendDocument(mail: MailSender, settings: CompanySettings | null, to: string, subject: string, text: string, attachments: Attachment[]): Promise<void> {
  if (settings?.mailFrom == null) throw new InvoiceError('Bitte trage unter ERP → Einstellungen einen Absender für E-Mails ein.')
  try {
    await mail({ from: settings.mailFrom, to, replyTo: settings.email, subject, text, attachments })
  }
  catch (e) {
    console.error('[cockpit erp] mail:', (e as Error).message)
    throw new InvoiceError('Die E-Mail konnte nicht übergeben werden. Bitte versuche es später noch einmal.')
  }
}
