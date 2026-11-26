import { decimal } from './format'

// Costs entered by hand, like src/Costs/Cost.php. German UI text.

export const CURRENCIES: Record<string, string> = { EUR: '€', USD: 'US$' }
export const INTERVALS: Record<string, string> = { month: 'monatlich', year: 'jährlich' }

export interface CostForm {
  name: string
  provider: string
  amount: string
  currency: string
  interval: string
  project: string
  note: string
}

export interface CostInput {
  name: string
  provider: string | null
  amountCents: number
  currency: string
  billingInterval: string
  projectId: number | null
  note: string | null
}

/** "12,99", "12.99", "1.200,50" or "1200" in cents; null if not a plausible amount. */
export function parseAmount(input: string): number | null {
  let value = input.trim().replaceAll(' ', '')
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) {
    value = value.replaceAll('.', '')
  }
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(value)
  if (m === null) return null
  return Number.parseInt(m[1]!, 10) * 100 + Number.parseInt((m[2] ?? '0').padEnd(2, '0'), 10)
}

/** Trims, replaces control characters by spaces and cuts to `max` characters; null if empty. */
function text(value: string, max: number): string | null {
  const cleaned = value.replace(/\p{C}+/gu, ' ').trim()
  return cleaned === '' ? null : [...cleaned].slice(0, max).join('')
}

/** Validates the form fields; returns the row or a German error message. */
export function costFromForm(input: Partial<CostForm>, projectIds: number[]): CostInput | string {
  const name = text(input.name ?? '', 100)
  if (name === null) return 'Bitte einen Namen eingeben.'
  const amount = parseAmount(input.amount ?? '')
  if (amount === null) return 'Der Betrag muss eine Zahl mit höchstens zwei Nachkommastellen sein, z. B. 12,99.'
  const currency = input.currency ?? ''
  if (!(currency in CURRENCIES)) return 'Unbekannte Währung.'
  const interval = input.interval ?? ''
  if (!(interval in INTERVALS)) return 'Unbekanntes Intervall.'
  const project = input.project ?? ''
  let projectId: number | null = null
  if (project !== '') {
    if (!/^\d+$/.test(project) || !projectIds.includes(Number(project))) return 'Unbekanntes Projekt.'
    projectId = Number(project)
  }
  return {
    name,
    provider: text(input.provider ?? '', 100),
    amountCents: amount,
    currency,
    billingInterval: interval,
    projectId,
    note: text(input.note ?? '', 255),
  }
}

/** Form fields of an entry being edited; the inverse of costFromForm(). */
export function costToForm(cost: CostInput): CostForm {
  return {
    name: cost.name,
    provider: cost.provider ?? '',
    amount: decimal(cost.amountCents / 100).replaceAll('.', ''),
    currency: cost.currency,
    interval: cost.billingInterval,
    project: cost.projectId !== null ? String(cost.projectId) : '',
    note: cost.note ?? '',
  }
}

/** Monthly and yearly totals per currency in cents, without converting between currencies. */
export function costTotals(costs: Pick<CostInput, 'amountCents' | 'currency' | 'billingInterval'>[]): Record<string, { month: number, year: number }> {
  const totals: Record<string, { month: number, year: number }> = {}
  for (const cost of costs) {
    const yearly = cost.billingInterval === 'year' ? cost.amountCents : cost.amountCents * 12
    totals[cost.currency] ??= { month: 0, year: 0 }
    totals[cost.currency]!.year += yearly
    totals[cost.currency]!.month += yearly / 12
  }
  return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** German money format, e.g. "1.234,50 €"; amount in cents. A no-break space keeps amount and currency together. */
export function money(cents: number, currency: string): string {
  return `${decimal(cents / 100)}\u00A0${CURRENCIES[currency] ?? currency}`
}
