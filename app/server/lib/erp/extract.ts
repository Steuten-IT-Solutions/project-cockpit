import { addDays, isValidIban } from '#shared/lib/erp'

// Suggestions for an incoming invoice without e-invoice data, read from the text of the
// PDF or photo (server/lib/erp/ocr.ts). Plain rules for German invoices: a label such
// as "Rechnungsnummer" or "Gesamtbetrag" and the value after it on the same line. The
// result only fills the form; the user checks it, so a field is left empty rather
// than guessed when the rules are not sure.

export interface ExtractedFields {
  number: string | null
  issueDate: string | null
  dueDate: string | null
  netCents: number | null
  taxCents: number | null
  grossCents: number | null
  iban: string | null
  vatId: string | null
  /** A known supplier whose VAT id, IBAN or name appears in the text. */
  supplierId: number | null
  /** The currency of the amounts (ISO 4217); EUR unless another one clearly dominates. */
  currency: string
  /** 'credit' when the document calls itself a credit note or refund. */
  kind: 'invoice' | 'credit'
}

// Signs of a currency in the text. A US invoice writes "$12.00" or "USD"; "US$" counts once.
const CURRENCIES: [string, RegExp][] = [
  ['EUR', /€|\bEUR\b|\beuro?s?\b/gi],
  ['USD', /US\$|(?<![A-Z])\$|\bUSD\b|\bUS dollars?\b/gi],
  ['GBP', /£|\bGBP\b/gi],
  ['CHF', /\bCHF\b|\bSFr\.?/gi],
]

/** The currency the text names most often; EUR on a tie or when none is named. */
export function currencyOf(text: string): string {
  let best = 'EUR'
  let most = 0
  for (const [code, sign] of CURRENCIES) {
    const count = (text.match(sign) ?? []).length
    if (count > most || (count === most && code === 'EUR')) {
      best = code
      most = count
    }
  }
  return best
}

export interface KnownSupplier { id: number, name: string, vatId: string | null, iban: string | null }

/** Own identifiers (from the company settings) that are on the invoice as the buyer's and must not be taken for the supplier's. */
export interface Own { iban: string | null, vatId: string | null }

/** An amount as printed in German ("1.234,56") or English ("1,234.56") style; null if none. */
export function amountCents(text: string): number | null {
  const m = /^-?(\d{1,3}(?:([.,' ])\d{3})*|\d+)([.,])(\d{2})$/.exec(text.trim())
  if (m === null) return null
  const thousands = m[2]
  if (thousands !== undefined && thousands === m[3]) return null // "1.234.56" is no amount
  const whole = Number.parseInt(m[1]!.replace(/[.,' ]/g, ''), 10)
  return whole * 100 + Number.parseInt(m[4]!, 10)
}

// An amount with two decimals, not followed by "%" (that is a rate) and not part of a longer number.
const AMOUNT = /(?<![\d.,])-?\d{1,3}(?:[.,' ]\d{3})*[.,]\d{2}(?![\d%]|\s*%)/g

/** The amounts on a line, in cents, left to right. */
function amounts(line: string): number[] {
  return [...line.matchAll(AMOUNT)].map(m => amountCents(m[0])).filter((v): v is number => v !== null && v >= 0)
}

// Month names in German and English, full and abbreviated, with their number.
const MONTHS: Record<string, number> = Object.fromEntries([
  ['januar', 'january', 'jan', 'jän'], ['februar', 'february', 'feb'], ['märz', 'march', 'mar', 'mär'], ['april', 'apr'], ['mai', 'may'],
  ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['august', 'aug'], ['september', 'sep', 'sept'], ['oktober', 'october', 'okt', 'oct'],
  ['november', 'nov'], ['dezember', 'december', 'dez', 'dec'],
].flatMap((names, i) => names.map(n => [n, i + 1])))
// Longest names first, so "sept" is not read as "sep" followed by "t".
const MONTH = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})\\.?`

/**
 * "27.11.2026", "27.11.26", "2026-11-27", "27. November 2026", "27 Nov 2026" or "November 27, 2026"
 * (English style, as on Stripe invoices) as ISO date; null if none or invalid.
 */
export function dateIso(text: string): string | null {
  let y: number, mo: number, d: number
  let m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/.exec(text)
  if (m !== null) {
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); if (y < 100) y += 2000
  }
  else if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(text)) !== null) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3])
  }
  else if ((m = new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s+${MONTH}\\s+(\\d{4})`, 'i').exec(text)) !== null) {
    d = Number(m[1]); mo = MONTHS[m[2]!.toLowerCase()]!; y = Number(m[3])
  }
  else if ((m = new RegExp(`(?<![a-zäöü])${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'i').exec(text)) !== null) {
    d = Number(m[2]); mo = MONTHS[m[1]!.toLowerCase()]!; y = Number(m[3])
  }
  else {
    return null
  }
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 2000 || y > 2100) return null
  return date.toISOString().slice(0, 10)
}

/** The value after the first line matching a label (labels tried in order): on the same line, else on the next one. */
function after(lines: string[], labels: RegExp[], value: (rest: string) => string | null): string | null {
  for (const label of labels) {
    for (const [i, line] of lines.entries()) {
      const m = label.exec(line)
      if (m === null) continue
      const found = value(line.slice(m.index + m[0].length)) ?? value(lines[i + 1] ?? '')
      if (found !== null) return found
    }
  }
  return null
}

/** The last amount of each line matching a label of the first group that matches at all; lines matching `skip` are left out. */
function amountsAfter(lines: string[], labels: RegExp[], skip: RegExp | null = null): number[] {
  for (const label of labels) {
    const found = lines.filter(l => label.test(l) && !(skip?.test(l) ?? false)).map(l => amounts(l).at(-1)).filter((v): v is number => v !== undefined)
    if (found.length > 0) return found
  }
  return []
}

const NUMBER_LABELS = [/(?:rechnungs-?\s?(?:nummer|nr\.?)|(?:rechnung|gutschrift)\s+(?:nr\.?|nummer)|(?:beleg|gutschrifts)-?\s?(?:nummer|nr\.?)|(?:invoice|credit\s+note)\s+(?:no\.?|number|#))\s*[:#.]?\s*/i]
const DATE_LABELS = [/(?:rechnungsdatum|belegdatum|ausstellungsdatum|invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+issued|issued\s+on)\s*[:.]?\s*/i,
  /(?<![a-zäöü])(?:datum|date)(?!\s+(?:due|of\s+(?:service|supply|delivery)|paid))\s*[:.]?\s*/i]
const DUE_LABELS = [/(?:fällig(?:\s+am|keit(?:sdatum)?)?|zahlbar\s+(?:bis|am)(?:\s+zum)?|zahlungsziel|due\s+date|date\s+due|payment\s+due|due\s+(?:on|by))\s*[:.]?\s*/i,
  /\bdue\s+/i]
const NET = /netto|zwischensumme|subtotal/i
const TAX = /umsatzsteuer|mehrwertsteuer|mwst|\bust\b(?!-?id)|\bvat\b(?!\s*(?:id|no|reg))/i
const GROSS_LABELS = [/gesamtbetrag|rechnungsbetrag|endbetrag|zahlbetrag|zu\s+zahlen|gesamtsumme|total\s+amount|amount\s+due/i, /brutto|gesamt|summe|total/i]

/** The fields that the text of an invoice yields; see the rules above. */
export function extractFields(text: string, suppliers: KnownSupplier[], own: Own): ExtractedFields {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l !== '')
  const flat = lines.join('\n')
  const compact = flat.replace(/\s+/g, '').toUpperCase()

  const number = after(lines, NUMBER_LABELS, (rest) => {
    const m = /^([A-Z0-9][A-Z0-9\-/._]{0,39})/i.exec(rest.trim())
    // A bare date or a word like "vom" is no number; a number has at least one digit.
    return m !== null && /\d/.test(m[1]!) && dateIso(m[1]!) === null ? m[1]!.replace(/[.,]$/, '') : null
  })
  const issueDate = after(lines, DATE_LABELS, dateIso) ?? lines.map(dateIso).find(d => d !== null) ?? null
  let dueDate = after(lines, DUE_LABELS, dateIso)
  if (dueDate === null && issueDate !== null) {
    const days = /(?:innerhalb\s+(?:von\s+)?|binnen\s+|zahlbar\s+in\s+)(\d{1,3})\s+tag/i.exec(flat)
    if (days !== null) dueDate = addDays(issueDate, Number(days[1]))
  }

  // Gross: the first strong label; else "Summe"/"Gesamt" lines that are not net or tax lines.
  let gross = amountsAfter(lines, GROSS_LABELS, new RegExp(`${NET.source}|${TAX.source}`, 'i'))[0] ?? null
  let net = amountsAfter(lines, [NET], TAX)[0] ?? null
  // Several rates give several tax lines; a "Summe" line repeats their total.
  const taxLines = amountsAfter(lines, [TAX])
  let tax = taxLines[0] ?? null
  const noVat = /§\s?19\s?UStG|kleinunternehmer|steuerfrei|reverse\s+charge|steuerschuldnerschaft\s+des\s+leistungsempfängers/i.test(flat)
  if (gross !== null && net !== null && taxLines.length > 1) {
    const sum = taxLines.reduce((a, b) => a + b, 0)
    if (net + sum === gross) tax = sum
    else if (taxLines.includes(gross - net)) tax = gross - net
  }
  // Two of the three give the third; anything that does not add up is dropped.
  if (gross !== null && net !== null && tax === null && gross >= net) tax = gross - net
  else if (gross !== null && tax !== null && net === null && gross >= tax) net = gross - tax
  else if (net !== null && tax !== null && gross === null) gross = net + tax
  else if (gross !== null && net === null && tax === null && noVat) {
    net = gross
    tax = 0
  }
  if (gross !== null && net !== null && tax !== null && net + tax !== gross) {
    net = null
    tax = null
  }

  const ownIban = own.iban?.replaceAll(' ', '').toUpperCase() ?? null
  const iban = [...flat.toUpperCase().matchAll(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?)\b/g)]
    .map(m => m[1]!.replaceAll(' ', ''))
    .find(candidate => isValidIban(candidate) && candidate !== ownIban) ?? null
  const ownVat = own.vatId?.replaceAll(' ', '').toUpperCase() ?? null
  const vatId = [...flat.toUpperCase().matchAll(/\b(DE) ?(\d{3}) ?(\d{3}) ?(\d{3})\b/g)]
    .map(m => m.slice(1, 5).join(''))
    .find(candidate => candidate !== ownVat) ?? null

  const name = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const lower = name(flat)
  const supplier = suppliers.find(s => s.vatId !== null && s.vatId !== '' && compact.includes(s.vatId.replaceAll(' ', '').toUpperCase()))
    ?? suppliers.find(s => s.iban !== null && s.iban !== '' && compact.includes(s.iban.replaceAll(' ', '').toUpperCase()))
    ?? suppliers.find(s => name(s.name).length >= 4 && lower.includes(name(s.name)))

  return { number, issueDate, dueDate, netCents: net, taxCents: tax, grossCents: gross, iban, vatId, supplierId: supplier?.id ?? null, currency: currencyOf(flat),
    kind: /\b(?:gutschrift|rückerstattung|erstattung|credit\s+note|refund)\b/i.test(flat) ? 'credit' : 'invoice' }
}
