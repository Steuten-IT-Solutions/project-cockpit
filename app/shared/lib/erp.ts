import { parseAmount } from './costs'
import { decimal } from './format'

// Rules of the ERP shared by the pages (live totals while typing) and the server (the
// figures that are stored and printed). Amounts are whole cents in EUR, quantities
// thousandths (1,5 Std. = 1500). The rounding is the same as in the PHP e-invoice code
// (src/Invoicing/InvoiceLine.php and Invoice.php), so screen, PDF and XML always agree.

/** UN/ECE Recommendation 20 unit codes, as src/Invoicing/InvoiceLine.php accepts them. */
export const UNITS: Record<string, string> = { C62: 'Stück', HUR: 'Std.', DAY: 'Tag(e)', MON: 'Monat(e)', LS: 'pauschal' }

/** VAT rates in percent. A small business (§ 19 UStG) may only use 0. */
export const VAT_RATES = [19, 7, 0] as const

export const CUSTOMER_KINDS: Record<string, string> = { business: 'Unternehmen', private: 'Privatperson' }

export const SMALL_BUSINESS_NOTE = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).'

export interface Line {
  name: string
  description: string | null
  quantityMilli: number
  unit: string
  unitPriceCents: number
  vatRate: number
}

/** A line as typed into the form: quantity and price as German text. */
export interface LineForm {
  name: string
  description: string
  quantity: string
  unit: string
  price: string
  vatRate: number
}

/** Net amount of a line in cents, rounded half up (like InvoiceLine::netCents()). */
export function lineNet(line: Pick<Line, 'quantityMilli' | 'unitPriceCents'>): number {
  return Math.floor((line.quantityMilli * line.unitPriceCents + 500) / 1000)
}

export interface VatGroup { category: 'S' | 'E', rate: number, basis: number, tax: number }

/** Net, VAT per rate and gross, like Invoice::vatBreakdown(): the tax is computed per rate on its sum. */
export function totals(lines: Pick<Line, 'quantityMilli' | 'unitPriceCents' | 'vatRate'>[]): { net: number, tax: number, gross: number, groups: VatGroup[] } {
  const groups = new Map<number, VatGroup>()
  for (const line of lines) {
    const group = groups.get(line.vatRate) ?? { category: line.vatRate === 0 ? 'E' : 'S', rate: line.vatRate, basis: 0, tax: 0 }
    group.basis += lineNet(line)
    groups.set(line.vatRate, group)
  }
  const list = [...groups.values()].sort((a, b) => b.rate - a.rate)
  for (const group of list) {
    group.tax = Math.floor((group.basis * group.rate + 50) / 100)
  }
  const net = list.reduce((sum, g) => sum + g.basis, 0)
  const tax = list.reduce((sum, g) => sum + g.tax, 0)
  return { net, tax, gross: net + tax, groups: list }
}

/** "1", "1,5", "0,25" or "1.000" in thousandths; null if not a positive quantity with up to 3 decimals. */
export function parseQuantity(input: string): number | null {
  let value = input.trim().replaceAll(' ', '')
  if (/^\d{1,3}(\.\d{3})+(,\d{1,3})?$/.test(value)) value = value.replaceAll('.', '')
  const m = /^(\d{1,6})(?:[.,](\d{1,3}))?$/.exec(value)
  if (m === null) return null
  const milli = Number.parseInt(m[1]!, 10) * 1000 + Number.parseInt((m[2] ?? '0').padEnd(3, '0'), 10)
  return milli > 0 ? milli : null
}

/** "1", "1,5", "0,25" from thousandths (like InvoicePdf::quantity()). */
export function quantity(milli: number): string {
  const whole = Math.floor(milli / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fraction = (milli % 1000).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction === '' ? whole : `${whole},${fraction}`
}

/** "1.234,50 €"; a no-break space keeps amount and sign together. */
export function euro(cents: number): string {
  return `${decimal(cents / 100)}\u00a0€`
}

/** Price as editable text without thousands separators: 49900 → "499,00". */
export function priceText(cents: number): string {
  return decimal(cents / 100).replaceAll('.', '')
}

/** Trims, replaces control characters and cuts to `max` characters; null if empty. */
export function cleanText(value: unknown, max: number, multiline = false): string | null {
  if (typeof value !== 'string') return null
  const cleaned = (multiline ? value.replace(/\r\n?/g, '\n').replace(/[^\P{C}\n]+/gu, ' ') : value.replace(/\p{C}+/gu, ' ')).trim()
  return cleaned === '' ? null : [...cleaned].slice(0, max).join('')
}

/** Validates a line; returns it or a German message naming the position. */
export function lineFromForm(form: Partial<LineForm>, position: number, smallBusiness: boolean): Line | string {
  const name = cleanText(form.name, 150)
  if (name === null) return `Position ${position}: Bitte eine Bezeichnung eingeben.`
  const quantityMilli = parseQuantity(form.quantity ?? '')
  if (quantityMilli === null) return `Position ${position}: Die Menge muss eine positive Zahl mit höchstens drei Nachkommastellen sein.`
  if (!(form.unit !== undefined && form.unit in UNITS)) return `Position ${position}: Unbekannte Einheit.`
  const unitPriceCents = parseAmount(form.price ?? '')
  if (unitPriceCents === null) return `Position ${position}: Der Preis muss ein Betrag wie 49,90 sein.`
  const vatRate = Number(form.vatRate)
  if (!(VAT_RATES as readonly number[]).includes(vatRate)) return `Position ${position}: Unbekannter Steuersatz.`
  if (smallBusiness && vatRate !== 0) return `Position ${position}: Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG).`
  return { name, description: cleanText(form.description, 500, true), quantityMilli, unit: form.unit, unitPriceCents, vatRate }
}

/** All lines of a document; at least one, at most 100. */
export function linesFromForm(forms: unknown, smallBusiness: boolean): Line[] | string {
  if (!Array.isArray(forms) || forms.length === 0) return 'Bitte mindestens eine Position erfassen.'
  if (forms.length > 100) return 'Höchstens 100 Positionen.'
  const lines: Line[] = []
  for (const [i, form] of forms.entries()) {
    const line = lineFromForm((form ?? {}) as Partial<LineForm>, i + 1, smallBusiness)
    if (typeof line === 'string') return line
    lines.push(line)
  }
  return lines
}

export function lineToForm(line: Line): LineForm {
  return {
    name: line.name, description: line.description ?? '', quantity: quantity(line.quantityMilli),
    unit: line.unit, price: priceText(line.unitPriceCents), vatRate: line.vatRate,
  }
}

/** ISO 13616 check of an IBAN (mod 97), spaces ignored. */
export function isValidIban(input: string): boolean {
  const iban = input.replaceAll(' ', '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const digits = [...iban.slice(4) + iban.slice(0, 4)].map(c => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('')
  let rest = 0
  for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97
  return rest === 1
}

/** "DE89 3704 0044 0532 0130 00". */
export function ibanText(iban: string): string {
  return iban.replaceAll(' ', '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
}

/** Format of an EU VAT id such as DE463748776 (format only; whether it is registered is checked by the BZSt). */
export function isVatId(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(value)
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value)
}

/** 'YYYY-MM-DD' if the text is a real calendar date, else null. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

/** A date plus days, both 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A date plus months, keeping the day where possible (31.01. + 1 → 28./29.02.). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

/** '2026-11-27' → '27.11.2026'; '–' if empty. */
export function day(value: string | null | undefined): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '–'
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`
}

/** Today in the cockpit's time zone as 'YYYY-MM-DD'. */
export function today(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Document numbers: R-2026-0001 (invoices), A-2026-0001 (quotes), AB-2026-0001 (orders). */
export const NUMBER_PREFIX: Record<string, string> = { invoice: 'R', quote: 'A', order: 'AB' }

export function documentNumber(kind: string, year: number, value: number): string {
  return `${NUMBER_PREFIX[kind] ?? kind}-${year}-${String(value).padStart(4, '0')}`
}

/** Days between two dates (b − a), both 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * Where an invoice stands. A cancellation (381) and the invoice it cancels are both
 * settled; anything else is paid once the payments cover the gross amount.
 */
export function invoiceState(invoice: { status: string, type: string, grossCents: number, paidCents: number, dueDate: string | null, cancelled: boolean }, todayDate: string): 'draft' | 'open' | 'overdue' | 'paid' | 'cancelled' | 'cancellation' {
  if (invoice.status === 'draft') return 'draft'
  if (invoice.type === '381') return 'cancellation'
  if (invoice.cancelled) return 'cancelled'
  if (invoice.paidCents >= invoice.grossCents) return 'paid'
  return invoice.dueDate !== null && invoice.dueDate < todayDate ? 'overdue' : 'open'
}

export const INVOICE_STATES: Record<string, { label: string, tone: 'neutral' | 'info' | 'warning' | 'success' | 'error' }> = {
  draft: { label: 'Entwurf', tone: 'neutral' },
  open: { label: 'Offen', tone: 'info' },
  overdue: { label: 'Überfällig', tone: 'error' },
  paid: { label: 'Bezahlt', tone: 'success' },
  cancelled: { label: 'Storniert', tone: 'neutral' },
  cancellation: { label: 'Stornorechnung', tone: 'neutral' },
}

/** Dunning levels: a friendly reminder first, then two reminders (no fees, no interest). */
export const REMINDER_LEVELS: Record<number, string> = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' }

/** Days the customer gets after a reminder. */
export const REMINDER_DAYS = 10

/** Text of a reminder e-mail (German, formal "Sie" towards customers). */
export function reminderText(r: { level: number, number: string, issueDate: string, dueDate: string, openCents: number, newDueDate: string, sellerName: string, iban: string, contactName: string | null }): string {
  const opening = r.level === 1
    ? `sicher ist es Ihrer Aufmerksamkeit entgangen: Unsere Rechnung ${r.number} vom ${day(r.issueDate)} war am ${day(r.dueDate)} fällig, ein Zahlungseingang ist bei uns bisher nicht verzeichnet.`
    : `leider konnten wir zu unserer Rechnung ${r.number} vom ${day(r.issueDate)} (fällig am ${day(r.dueDate)}) trotz ${r.level === 2 ? 'unserer Zahlungserinnerung' : 'unserer Mahnung'} noch keinen Zahlungseingang feststellen.`
  return [
    'Sehr geehrte Damen und Herren,',
    '',
    opening,
    '',
    `Offener Betrag: ${euro(r.openCents)}`,
    `Bitte überweisen Sie den Betrag bis zum ${day(r.newDueDate)} auf das Konto ${ibanText(r.iban)} unter Angabe der Rechnungsnummer ${r.number}.`,
    '',
    'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.',
    '',
    'Die Rechnung hängt dieser E-Mail noch einmal an.',
    '',
    'Mit freundlichen Grüßen',
    r.contactName ?? r.sellerName,
    r.contactName !== null ? r.sellerName : '',
  ].join('\n').trimEnd() + '\n'
}

export const DEFAULT_MAIL_TEXT = 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere {dokument} {nummer} über {betrag}.\n\nMit freundlichen Grüßen\n{absender}'

/** Fills {dokument}, {nummer}, {betrag}, {faellig} and {absender} into the mail text. */
export function mailText(template: string | null, values: { document: string, number: string, grossCents: number, dueDate: string | null, sender: string }): string {
  const map: Record<string, string> = {
    dokument: values.document, nummer: values.number, betrag: euro(values.grossCents),
    faellig: day(values.dueDate), absender: values.sender,
  }
  return (template ?? DEFAULT_MAIL_TEXT).replace(/\{(dokument|nummer|betrag|faellig|absender)\}/g, (_, key: string) => map[key]!)
}

/** Billing period of a recurring invoice: from the date to the day before the next one. */
export function period(from: string, months: number): { from: string, to: string } {
  return { from, to: addDays(addMonths(from, months), -1) }
}

export const SUBSCRIPTION_INTERVALS: Record<number, string> = { 1: 'monatlich', 3: 'vierteljährlich', 6: 'halbjährlich', 12: 'jährlich' }

/** Categories of incoming invoices, for the evaluation (no bookkeeping accounts). */
export const INCOMING_CATEGORIES: Record<string, string> = {
  hosting: 'Hosting und Server',
  software: 'Software und Lizenzen',
  hardware: 'Hardware',
  services: 'Fremdleistungen',
  telecom: 'Telefon und Internet',
  office: 'Büro',
  travel: 'Reisen',
  training: 'Fortbildung',
  other: 'Sonstiges',
}

export const QUOTE_STATES: Record<string, string> = { draft: 'Entwurf', sent: 'Ausgestellt', accepted: 'Angenommen', rejected: 'Abgelehnt' }
export const ORDER_STATES: Record<string, string> = { draft: 'Entwurf', sent: 'Bestätigt', invoiced: 'Abgerechnet' }

/** Days a quote stays valid unless changed. */
export const QUOTE_VALID_DAYS = 30

/**
 * One CSV row with semicolons, as German Excel expects. Text that a spreadsheet would
 * run as a formula (=, +, -, @ at the start, except plain numbers) gets a leading
 * apostrophe, the usual guard against CSV injection.
 */
export function csvRow(values: (string | number | null)[]): string {
  return values.map((v) => {
    let text = v === null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(,\d+)?$/.test(text)) text = `'${text}`
    return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }).join(';')
}

/** Cents as "1234,50" for CSV (no thousands separator, no currency sign). */
export function csvAmount(cents: number): string {
  return (cents < 0 ? '-' : '') + priceText(Math.abs(cents))
}
