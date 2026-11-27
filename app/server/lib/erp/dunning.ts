import { addDays, openAmount, REMINDER_DAYS, REMINDER_LEVELS, reminderText } from '#shared/lib/erp'
import type { CompanySettings, InvoiceDetail } from '#shared/types/erp'
import { InvoiceError } from './invoices'

// The next reminder of an overdue invoice (module 2): level, new deadline and text.

export interface ReminderDraft { level: number, title: string, newDueDate: string, openCents: number, subject: string, text: string }

export function nextReminder(invoice: InvoiceDetail, settings: CompanySettings | null, today: string): ReminderDraft {
  if (invoice.status !== 'final' || invoice.type !== '380') throw new InvoiceError('Nur festgeschriebene Rechnungen können angemahnt werden.')
  if (invoice.state === 'cancelled') throw new InvoiceError('Die Rechnung ist storniert.')
  if (invoice.state === 'paid') throw new InvoiceError('Die Rechnung ist bezahlt.')
  if (invoice.state !== 'overdue') throw new InvoiceError('Die Rechnung ist noch nicht fällig.')
  const level = invoice.reminderLevel + 1
  const title = REMINDER_LEVELS[level]
  if (title === undefined) throw new InvoiceError('Nach der 2. Mahnung schickt das Cockpit keine weitere. Der nächste Schritt wäre ein gerichtliches Mahnverfahren.')
  // A reminder sent earlier set a deadline; the next one waits until that has passed.
  const last = invoice.reminders.at(-1)
  if (last !== undefined && last.newDueDate >= today) throw new InvoiceError(`Die Frist der letzten Erinnerung läuft noch bis ${last.newDueDate.split('-').reverse().join('.')}.`)
  if (settings === null) throw new InvoiceError('Bitte trage zuerst deine Firmendaten ein.')
  const openCents = openAmount(invoice)
  const newDueDate = addDays(today, REMINDER_DAYS)
  const text = reminderText({
    level, number: invoice.number!, issueDate: invoice.issueDate!, dueDate: invoice.dueDate!, openCents, newDueDate,
    sellerName: settings.name, iban: settings.iban, contactName: settings.contactName,
  })
  return { level, title, newDueDate, openCents, subject: `${title}: Rechnung ${invoice.number} – ${settings.name}`, text }
}
