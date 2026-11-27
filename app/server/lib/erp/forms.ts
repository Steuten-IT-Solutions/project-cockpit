import { parseAmount } from '#shared/lib/costs'
import type { ProjectShare } from '#shared/types/erp'
import { cleanText, CURRENCIES, CUSTOMER_KINDS, INCOMING_CATEGORIES, isEmail, isoDate, isValidIban, isVatId, MAIL_SENDERS, type MailSenderField, parsePercent, parseQuantity, SUBSCRIPTION_INTERVALS, euroParts, UNITS, VAT_RATES } from '#shared/lib/erp'

// Validation of the ERP's forms. Each function takes the request body and returns the
// clean values or a German message for the user. Pure, unit tested.

type Body = Record<string, unknown>

const field = (body: Body, key: string) => body[key]
const optional = (body: Body, key: string, max: number) => cleanText(field(body, key), max)

/** A numeric id field ('' or null: none); 'invalid' if it is not a positive integer. */
export function idField(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : Number.NaN
  return Number.isInteger(n) && n > 0 ? n : 'invalid'
}

function country(value: unknown): string | null {
  const c = typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : 'DE'
  return /^[A-Z]{2}$/.test(c) ? c : null
}

/** Street, postcode, city and country; German postcodes have five digits. */
function address(body: Body, required: boolean): { street: string | null, postcode: string | null, city: string | null, country: string | null } | string {
  const street = optional(body, 'street', 100)
  const postcode = optional(body, 'postcode', 10)
  const city = optional(body, 'city', 100)
  const c = country(field(body, 'country'))
  if (c === null) return 'Das Land muss ein Ländercode wie DE sein.'
  if (required && (street === null || postcode === null || city === null)) return 'Bitte Straße, PLZ und Ort angeben.'
  if (postcode !== null && c === 'DE' && !/^\d{5}$/.test(postcode)) return 'Eine deutsche PLZ hat fünf Ziffern.'
  return { street, postcode, city, country: c }
}

export interface CustomerInput {
  kind: string, name: string, contactName: string | null, street: string, postcode: string, city: string, country: string
  email: string | null, vatId: string | null, projectId: number | null, note: string | null
}

export function customerFromBody(body: Body, projectIds: number[]): CustomerInput | string {
  const kind = String(field(body, 'kind') ?? '')
  if (!(kind in CUSTOMER_KINDS)) return 'Bitte wähle, ob der Kunde ein Unternehmen oder eine Privatperson ist.'
  const name = optional(body, 'name', 100)
  if (name === null) return 'Bitte einen Namen eingeben.'
  const place = address(body, true)
  if (typeof place === 'string') return place
  const email = optional(body, 'email', 190)
  if (email !== null && !isEmail(email)) return 'Die E-Mail-Adresse ist ungültig.'
  const vatId = optional(body, 'vatId', 20)?.replaceAll(' ', '').toUpperCase() ?? null
  if (vatId !== null && !isVatId(vatId)) return 'Die USt-IdNr. hat nicht das Format DE123456789.'
  const projectId = idField(field(body, 'projectId'))
  if (projectId === 'invalid' || (projectId !== null && !projectIds.includes(projectId))) return 'Unbekanntes Projekt.'
  return {
    kind, name, contactName: optional(body, 'contactName', 100), street: place.street!, postcode: place.postcode!, city: place.city!,
    country: place.country!, email, vatId: kind === 'business' ? vatId : null, projectId, note: optional(body, 'note', 255),
  }
}

export interface CatalogInput { name: string, description: string | null, unit: string, unitPriceCents: number, vatRate: number }

export function catalogFromBody(body: Body, smallBusiness: boolean): CatalogInput | string {
  const name = optional(body, 'name', 150)
  if (name === null) return 'Bitte eine Bezeichnung eingeben.'
  const unit = String(field(body, 'unit') ?? '')
  if (!(unit in UNITS)) return 'Unbekannte Einheit.'
  const unitPriceCents = parseAmount(String(field(body, 'price') ?? ''))
  if (unitPriceCents === null) return 'Der Preis muss ein Betrag wie 49,90 sein.'
  const vatRate = Number(field(body, 'vatRate'))
  if (!(VAT_RATES as readonly number[]).includes(vatRate)) return 'Unbekannter Steuersatz.'
  if (smallBusiness && vatRate !== 0) return 'Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG).'
  return { name, description: cleanText(field(body, 'description'), 500, true), unit, unitPriceCents, vatRate }
}

export interface SettingsInput extends Record<MailSenderField, string | null> {
  name: string, contactName: string | null, street: string, postcode: string, city: string, country: string
  email: string | null, phone: string | null, website: string | null, taxNumber: string | null, vatId: string | null
  iban: string, bic: string | null, bankName: string | null, smallBusiness: boolean, paymentDays: number
  exemptionReason: string | null, mailFrom: string | null, mailText: string | null
}

/** "Name <address>" or a bare address. */
function isSender(value: string): boolean {
  return isEmail(/<([^>]+)>$/.exec(value)?.[1] ?? value)
}

export function settingsFromBody(body: Body): SettingsInput | string {
  const name = optional(body, 'name', 100)
  if (name === null) return 'Bitte den Namen deines Unternehmens eingeben.'
  const place = address(body, true)
  if (typeof place === 'string') return place
  const email = optional(body, 'email', 190)
  if (email !== null && !isEmail(email)) return 'Die E-Mail-Adresse ist ungültig.'
  const taxNumber = optional(body, 'taxNumber', 30)
  const vatId = optional(body, 'vatId', 20)?.replaceAll(' ', '').toUpperCase() ?? null
  if (vatId !== null && !isVatId(vatId)) return 'Die USt-IdNr. hat nicht das Format DE123456789.'
  if (taxNumber === null && vatId === null) return 'Auf jeder Rechnung muss die Steuernummer oder die USt-IdNr. stehen (§ 14 Abs. 4 UStG).'
  const iban = (optional(body, 'iban', 50) ?? '').replaceAll(' ', '').toUpperCase()
  if (!isValidIban(iban)) return 'Die IBAN ist ungültig.'
  const bic = optional(body, 'bic', 11)?.replaceAll(' ', '').toUpperCase() ?? null
  if (bic !== null && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return 'Die BIC ist ungültig.'
  const paymentDays = Number(field(body, 'paymentDays'))
  if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 120) return 'Das Zahlungsziel muss zwischen 0 und 120 Tagen liegen.'
  const mailFrom = optional(body, 'mailFrom', 190)
  if (mailFrom !== null && !isSender(mailFrom)) return 'Der Absender muss eine E-Mail-Adresse sein, z. B. Steuten IT Solutions <rechnung@steuten-it-solutions.de>.'
  const senders = {} as Record<MailSenderField, string | null>
  for (const { field: key, label } of MAIL_SENDERS) {
    const value = optional(body, key, 190)
    if (value !== null && !isSender(value)) return `Der Absender für ${label} muss eine E-Mail-Adresse sein, z. B. Steuten IT Solutions <rechnung@steuten-it-solutions.de>.`
    senders[key] = value
  }
  return {
    name, contactName: optional(body, 'contactName', 100), street: place.street!, postcode: place.postcode!, city: place.city!, country: place.country!,
    email, phone: optional(body, 'phone', 50), website: optional(body, 'website', 190), taxNumber, vatId, iban, bic,
    bankName: optional(body, 'bankName', 100), smallBusiness: field(body, 'smallBusiness') === true, paymentDays,
    exemptionReason: optional(body, 'exemptionReason', 255), mailFrom, ...senders, mailText: cleanText(field(body, 'mailText'), 2000, true),
  }
}

export interface SupplierInput {
  name: string, vatId: string | null, taxNumber: string | null, iban: string | null, email: string | null
  street: string | null, postcode: string | null, city: string | null, country: string | null, note: string | null
}

export function supplierFromBody(body: Body): SupplierInput | string {
  const name = optional(body, 'name', 100)
  if (name === null) return 'Bitte den Namen des Lieferanten eingeben.'
  const place = address(body, false)
  if (typeof place === 'string') return place
  const iban = optional(body, 'iban', 50)?.replaceAll(' ', '').toUpperCase() ?? null
  if (iban !== null && !isValidIban(iban)) return 'Die IBAN ist ungültig.'
  const email = optional(body, 'email', 190)
  if (email !== null && !isEmail(email)) return 'Die E-Mail-Adresse ist ungültig.'
  const vatId = optional(body, 'vatId', 20)?.replaceAll(' ', '').toUpperCase() ?? null
  if (vatId !== null && !isVatId(vatId)) return 'Die USt-IdNr. hat nicht das Format DE123456789.'
  return { name, vatId, taxNumber: optional(body, 'taxNumber', 30), iban, email, ...place, note: optional(body, 'note', 255) }
}

export interface IncomingInput {
  number: string, issueDate: string, dueDate: string | null, netCents: number, taxCents: number, grossCents: number
  category: string, projects: ProjectShare[], iban: string | null, note: string | null
  /** 'credit' for a credit note or refund of the supplier, optionally for the incoming invoice relatedId. */
  kind: 'invoice' | 'credit', relatedId: number | null
  /** The invoice's currency; for another one than EUR the amounts above are the euros entered for it. */
  currency: string, originalNetCents: number | null, originalTaxCents: number | null, exchangeRate: number | null
}

/**
 * The projects an incoming invoice is split across: "projects" as a list (or its JSON
 * text, from a multipart form) of { projectId, share } with the share in percent, or
 * the older single "projectId". One project takes 100 %; several must add up to 100 %.
 */
export function projectSharesFromBody(body: Body, projectIds: number[]): ProjectShare[] | string {
  let list: unknown = field(body, 'projects')
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    }
    catch {
      return 'Die Projektzuordnung ist ungültig.'
    }
  }
  if (list === undefined || list === null) list = [{ projectId: field(body, 'projectId'), share: '' }]
  if (!Array.isArray(list) || list.length > 20) return 'Die Projektzuordnung ist ungültig.'
  const rows: { projectId: number, share: unknown }[] = []
  for (const item of list as unknown[]) {
    const entry = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const projectId = idField(entry.projectId)
    if (projectId === null) continue
    if (projectId === 'invalid' || !projectIds.includes(projectId)) return 'Unbekanntes Projekt.'
    if (rows.some(r => r.projectId === projectId)) return 'Jedes Projekt darf nur einmal vorkommen.'
    rows.push({ projectId, share: entry.share })
  }
  if (rows.length === 1) return [{ projectId: rows[0]!.projectId, shareBp: 10000 }]
  const shares: ProjectShare[] = []
  for (const r of rows) {
    const shareBp = parsePercent(String(r.share ?? ''))
    if (shareBp === null || shareBp === 0) return 'Bitte für jedes Projekt einen Anteil in Prozent eintragen, z. B. 50 oder 33,33.'
    shares.push({ projectId: r.projectId, shareBp })
  }
  if (shares.length > 0 && shares.reduce((a, b) => a + b.shareBp, 0) !== 10000) return 'Die Anteile der Projekte müssen zusammen 100 % ergeben.'
  return shares
}

/** The editable fields of an incoming invoice; amounts as German text, gross = net + tax. */
export function incomingFromBody(body: Body, projectIds: number[]): IncomingInput | string {
  const kind = field(body, 'kind') === 'credit' ? 'credit' : 'invoice'
  const number = optional(body, 'number', 60)
  if (number === null) return kind === 'credit' ? 'Bitte die Nummer der Gutschrift eingeben.' : 'Bitte die Rechnungsnummer des Lieferanten eingeben.'
  const issueDate = isoDate(field(body, 'issueDate'))
  if (issueDate === null) return kind === 'credit' ? 'Bitte das Datum der Gutschrift angeben.' : 'Bitte das Rechnungsdatum angeben.'
  const due = field(body, 'dueDate')
  const dueDate = due === '' || due === null || due === undefined ? null : isoDate(due)
  if (dueDate === null && due !== '' && due !== null && due !== undefined) return 'Das Fälligkeitsdatum ist ungültig.'
  const netCents = parseAmount(String(field(body, 'net') ?? ''))
  const taxCents = parseAmount(String(field(body, 'tax') ?? '0') || '0')
  if (netCents === null || taxCents === null) return 'Netto und Steuer müssen Beträge wie 49,90 sein.'
  // An invoice in another currency: net and tax are typed as printed on it, and the euro
  // total ("euroGross", e.g. from the bank statement) is what goes into the books.
  const currency = String(field(body, 'currency') ?? 'EUR') || 'EUR'
  if (!(currency in CURRENCIES)) return 'Unbekannte Währung.'
  let amounts = { netCents, taxCents }
  let exchangeRate: number | null = null
  if (currency !== 'EUR') {
    const euroGross = parseAmount(String(field(body, 'euroGross') ?? ''))
    if (euroGross === null || euroGross === 0) return `Bitte den Betrag in Euro eintragen, z. B. wie er vom Konto abgebucht wurde.`
    amounts = euroParts(euroGross, netCents, taxCents)
    // The rate this means, units of the currency per euro (as banks and the ECB quote it); for reference only.
    exchangeRate = Number(((netCents + taxCents) / euroGross).toFixed(6))
  }
  const category = String(field(body, 'category') ?? '')
  if (!(category in INCOMING_CATEGORIES)) return 'Bitte eine Kategorie wählen.'
  const related = idField(field(body, 'relatedId'))
  if (related === 'invalid') return 'Unbekannte Rechnung für die Gutschrift.'
  const projects = projectSharesFromBody(body, projectIds)
  if (typeof projects === 'string') return projects
  const iban = optional(body, 'iban', 50)?.replaceAll(' ', '').toUpperCase() ?? null
  if (iban !== null && !isValidIban(iban)) return 'Die IBAN ist ungültig.'
  return {
    number, issueDate, dueDate, netCents: amounts.netCents, taxCents: amounts.taxCents, grossCents: amounts.netCents + amounts.taxCents, category, projects, iban,
    note: cleanText(field(body, 'note'), 500, true), currency, exchangeRate, kind, relatedId: kind === 'credit' ? related : null,
    originalNetCents: exchangeRate === null ? null : netCents, originalTaxCents: exchangeRate === null ? null : taxCents,
  }
}

export interface TimeInput {
  workDate: string, customerId: number, projectId: number | null, orderId: number | null, description: string
  quantityMilli: number, unit: string, unitPriceCents: number, vatRate: number
}

export function timeFromBody(body: Body, known: { customers: number[], projects: number[], orders: number[] }, smallBusiness: boolean): TimeInput | string {
  const workDate = isoDate(field(body, 'workDate'))
  if (workDate === null) return 'Bitte das Datum angeben.'
  const customerId = idField(field(body, 'customerId'))
  if (customerId === null || customerId === 'invalid' || !known.customers.includes(customerId)) return 'Bitte einen Kunden wählen.'
  const projectId = idField(field(body, 'projectId'))
  if (projectId === 'invalid' || (projectId !== null && !known.projects.includes(projectId))) return 'Unbekanntes Projekt.'
  const orderId = idField(field(body, 'orderId'))
  if (orderId === 'invalid' || (orderId !== null && !known.orders.includes(orderId))) return 'Unbekannter Auftrag.'
  const description = cleanText(field(body, 'description'), 500, true)
  if (description === null) return 'Bitte beschreiben, was du gemacht hast.'
  const quantityMilli = parseQuantity(String(field(body, 'quantity') ?? ''))
  if (quantityMilli === null) return 'Die Menge muss eine positive Zahl mit höchstens drei Nachkommastellen sein, z. B. 1,5.'
  const unit = String(field(body, 'unit') ?? '')
  if (!(unit in UNITS)) return 'Unbekannte Einheit.'
  const unitPriceCents = parseAmount(String(field(body, 'price') ?? ''))
  if (unitPriceCents === null) return 'Der Preis muss ein Betrag wie 90,00 sein.'
  const vatRate = Number(field(body, 'vatRate'))
  if (!(VAT_RATES as readonly number[]).includes(vatRate)) return 'Unbekannter Steuersatz.'
  if (smallBusiness && vatRate !== 0) return 'Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG).'
  return { workDate, customerId, projectId, orderId, description, quantityMilli, unit, unitPriceCents, vatRate }
}

export interface SubscriptionInput {
  customerId: number, projectId: number | null, name: string, intervalMonths: number, nextDate: string
  endDate: string | null, note: string | null, active: boolean
}

export function subscriptionFromBody(body: Body, known: { customers: number[], projects: number[] }): SubscriptionInput | string {
  const customerId = idField(field(body, 'customerId'))
  if (customerId === null || customerId === 'invalid' || !known.customers.includes(customerId)) return 'Bitte einen Kunden wählen.'
  const projectId = idField(field(body, 'projectId'))
  if (projectId === 'invalid' || (projectId !== null && !known.projects.includes(projectId))) return 'Unbekanntes Projekt.'
  const name = optional(body, 'name', 100)
  if (name === null) return 'Bitte einen Namen eingeben, z. B. Wartungsvertrag.'
  const intervalMonths = Number(field(body, 'intervalMonths'))
  if (!(intervalMonths in SUBSCRIPTION_INTERVALS)) return 'Unbekanntes Intervall.'
  const nextDate = isoDate(field(body, 'nextDate'))
  if (nextDate === null) return 'Bitte das Datum der nächsten Rechnung angeben.'
  const end = field(body, 'endDate')
  const endDate = end === '' || end === null || end === undefined ? null : isoDate(end)
  if (endDate === null && end !== '' && end !== null && end !== undefined) return 'Das Enddatum ist ungültig.'
  if (endDate !== null && endDate < nextDate) return 'Das Enddatum liegt vor der nächsten Rechnung.'
  return { customerId, projectId, name, intervalMonths, nextDate, endDate, note: cleanText(field(body, 'note'), 2000, true), active: field(body, 'active') !== false }
}

/** Common fields of invoice drafts, quotes and orders. */
export interface DocumentHead { customerId: number, projectId: number | null, note: string | null }

export function headFromBody(body: Body, known: { customers: number[], projects: number[] }): DocumentHead | string {
  const customerId = idField(field(body, 'customerId'))
  if (customerId === null || customerId === 'invalid' || !known.customers.includes(customerId)) return 'Bitte einen Kunden wählen.'
  const projectId = idField(field(body, 'projectId'))
  if (projectId === 'invalid' || (projectId !== null && !known.projects.includes(projectId))) return 'Unbekanntes Projekt.'
  return { customerId, projectId, note: cleanText(field(body, 'note'), 2000, true) }
}
