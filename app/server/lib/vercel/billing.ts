import type { Charge } from '#shared/lib/costs'
import type { BillingRepository } from '../repositories/billing'
import { cut, isRecord, printable } from '../text'
import { parseJson, type VercelClient, vercelReason } from './client'

// The team's charges of the current calendar month (UTC) from GET /v1/billing/charges,
// stored summed per service, category and project (src/Vercel/BillingSync.php, Charges.php).

const CATEGORIES = ['Adjustment', 'Credit', 'Purchase', 'Tax', 'Usage']

/** Numbers arrive as JSON numbers or as decimal strings. */
function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value)) return Number(value)
  return null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = printable(value)
  return cleaned === '' ? null : cut(cleaned, 150)
}

/** Vercel documents that tags carry the project name but not the exact key: any key ending in "ProjectName". */
function projectName(tags: unknown): string | null {
  if (!isRecord(tags)) return null
  for (const [key, value] of Object.entries(tags)) {
    if (/projectname$/i.test(key)) return text(value)
  }
  return null
}

/** Sums the FOCUS charge records (JSON Lines, one per line). Throws on lines it cannot read. */
export function aggregateCharges(jsonl: string): Charge[] {
  const sums = new Map<string, Charge>()
  jsonl.split(/\r?\n/).forEach((line, n) => {
    if (line.trim() === '') return
    const charge = parseJson(line)
    if (!isRecord(charge)) {
      throw new Error(`Unexpected charges response (line ${n + 1} is not JSON).`)
    }
    const billed = number(charge.BilledCost)
    const effective = number(charge.EffectiveCost) ?? billed
    const currency = charge.BillingCurrency
    if (billed === null || effective === null || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Unexpected charges response (line ${n + 1} lacks cost or currency).`)
    }
    const service = text(charge.ServiceName) ?? 'Unbekannt'
    const category = typeof charge.ChargeCategory === 'string' && CATEGORIES.includes(charge.ChargeCategory) ? charge.ChargeCategory : 'Other'
    const project = projectName(charge.Tags)
    const key = [service, category, project ?? '', currency].join('\0')
    const sum = sums.get(key) ?? { service, category, project, billedCost: 0, effectiveCost: 0, currency }
    sum.billedCost += billed
    sum.effectiveCost += effective
    sums.set(key, sum)
  })
  return [...sums.values()]
}

/** First day of the month and the day after today (exclusive end), both UTC dates. */
export function billingPeriod(now: number): [string, string] {
  const today = new Date(now * 1000).toISOString().slice(0, 10)
  return [`${today.slice(0, 7)}-01`, new Date((now + 86400) * 1000).toISOString().slice(0, 10)]
}

/** Returns the billed cost per currency. */
export async function syncBilling(client: VercelClient, store: BillingRepository, now: number, syncedAt: string): Promise<Record<string, number>> {
  const [from, to] = billingPeriod(now)
  const { status, body } = await client.getRaw('/v1/billing/charges', { from: `${from}T00:00:00.000Z`, to: `${to}T00:00:00.000Z` }, 'application/jsonl, application/json')
  if (status !== 200) {
    throw new Error(`Vercel returned ${status} for /v1/billing/charges${vercelReason(parseJson(body))}.`)
  }
  const sums = aggregateCharges(body)
  await store.replace(sums, from, to, syncedAt)
  const totals: Record<string, number> = {}
  for (const s of sums) totals[s.currency] = (totals[s.currency] ?? 0) + s.billedCost
  return totals
}
