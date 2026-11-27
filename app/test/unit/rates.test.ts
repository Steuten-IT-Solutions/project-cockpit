import { describe, expect, it } from 'vitest'
import { parseRate, rateText, toEuroCents } from '../../shared/lib/erp'
import { incomingFromBody } from '../../server/lib/erp/forms'
import { ecbRate, lastRate } from '../../server/lib/erp/rates'

// The ECB's CSV answer as returned with detail=dataonly (shortened).
const CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-12,1.1081
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-13,1.1052
`

describe('invoices in another currency', () => {
  it('reads and converts exchange rates', () => {
    expect(parseRate('1,0989')).toBe(1.0989)
    expect(parseRate('1.0989')).toBe(1.0989)
    expect(parseRate('0')).toBeNull()
    expect(parseRate('abc')).toBeNull()
    expect(rateText(1.1052)).toBe('1,1052')
    // 100,00 $ at 1,25 $ per euro are 80,00 €.
    expect(toEuroCents(10000, 1.25)).toBe(8000)
    expect(toEuroCents(999, 1.1052)).toBe(904)
  })

  it('takes the last ECB rate up to the day', async () => {
    expect(lastRate(CSV)).toEqual({ rate: 1.1052, date: '2026-11-13' })
    expect(lastRate('')).toBeNull()
    const urls: string[] = []
    const fetcher = async (url: string) => {
      urls.push(url)
      return { ok: true, status: 200, text: async () => CSV }
    }
    // Sunday the 15th: the Friday rate counts.
    expect(await ecbRate('USD', '2026-11-15', fetcher)).toEqual({ rate: 1.1052, date: '2026-11-13' })
    expect(urls[0]).toContain('EXR/D.USD.EUR.SP00.A?startPeriod=2026-11-05&endPeriod=2026-11-15')
    expect(await ecbRate('CHF', '2026-11-15', async () => ({ ok: false, status: 404, text: async () => '' }))).toBeNull()
    await expect(ecbRate('GBP', '2026-11-15', async () => ({ ok: false, status: 500, text: async () => '' }))).rejects.toThrow('500')
  })

  it('stores euros and keeps the amounts of the invoice', () => {
    const body = { number: 'INV-1', issueDate: '2026-11-03', net: '100', tax: '0', category: 'software', currency: 'USD', rate: '1,25' }
    expect(incomingFromBody(body, [])).toMatchObject({ netCents: 8000, taxCents: 0, grossCents: 8000, currency: 'USD', originalNetCents: 10000, exchangeRate: 1.25 })
    expect(incomingFromBody({ ...body, rate: '' }, [])).toMatch(/Kurs/)
    expect(incomingFromBody({ ...body, currency: 'JPY' }, [])).toBe('Unbekannte Währung.')
    expect(incomingFromBody({ ...body, currency: undefined }, [])).toMatchObject({ netCents: 10000, currency: 'EUR', exchangeRate: null, originalNetCents: null })
  })
})
