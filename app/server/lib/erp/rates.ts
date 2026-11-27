// Reference exchange rates of the European Central Bank, for incoming invoices in another
// currency. The ECB publishes one rate per working day at about 16:00 CET, as units of
// the currency per 1 euro (e.g. 1.0989 US dollars). For a day without a rate (weekend,
// holiday, or today before publication) the last rate before it is taken. Only the
// currency and a date range are sent to the ECB, nothing about the invoice.

export interface Rate { rate: number, date: string }

type Fetch = (url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

const cache = new Map<string, Rate>()

/** The ECB rate valid on `date` (YYYY-MM-DD); null if the ECB has none in the 10 days before. */
export async function ecbRate(currency: string, date: string, fetcher: Fetch = fetch): Promise<Rate | null> {
  const key = `${currency}:${date}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 10)
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${encodeURIComponent(currency)}.EUR.SP00.A`
    + `?startPeriod=${start.toISOString().slice(0, 10)}&endPeriod=${date}&format=csvdata&detail=dataonly`
  const response = await fetcher(url)
  if (response.status === 404) return null // no data in that range
  if (!response.ok) throw new Error(`ECB answered ${response.status}`)
  const rate = lastRate(await response.text())
  // Only rates of past days are final; today's may still come.
  if (rate !== null && date < new Date().toISOString().slice(0, 10)) cache.set(key, rate)
  return rate
}

/** The last TIME_PERIOD/OBS_VALUE pair of the ECB's CSV answer. */
export function lastRate(csv: string): Rate | null {
  const [head, ...lines] = csv.trim().split(/\r?\n/)
  const columns = (head ?? '').split(',')
  const day = columns.indexOf('TIME_PERIOD')
  const value = columns.indexOf('OBS_VALUE')
  if (day < 0 || value < 0) return null
  let found: Rate | null = null
  for (const line of lines) {
    const cells = line.split(',')
    const rate = Number(cells[value])
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[day] ?? '') && Number.isFinite(rate) && rate > 0 && (found === null || cells[day]! > found.date)) {
      found = { rate, date: cells[day]! }
    }
  }
  return found
}
