import { describe, expect, it } from 'vitest'
import { euroParts } from '../../shared/lib/erp'
import { incomingFromBody } from '../../server/lib/erp/forms'

describe('invoices in another currency', () => {
  it('splits the euro amount like the invoice', () => {
    expect(euroParts(8000, 10000, 0)).toEqual({ netCents: 8000, taxCents: 0 })
    // 100 $ net + 19 $ tax, 101,15 € debited: 85,00 € + 16,15 €.
    expect(euroParts(10115, 10000, 1900)).toEqual({ netCents: 8500, taxCents: 1615 })
    expect(euroParts(500, 0, 0)).toEqual({ netCents: 500, taxCents: 0 })
  })

  it('stores the euros entered and keeps the amounts of the invoice', () => {
    const body = { number: 'INV-1', issueDate: '2026-11-03', net: '100', tax: '0', category: 'software', currency: 'USD', euroGross: '80,00' }
    expect(incomingFromBody(body, [])).toMatchObject({ netCents: 8000, taxCents: 0, grossCents: 8000, currency: 'USD', originalNetCents: 10000, originalTaxCents: 0, exchangeRate: 1.25 })
    expect(incomingFromBody({ ...body, euroGross: '' }, [])).toMatch(/Betrag in Euro/)
    expect(incomingFromBody({ ...body, currency: 'JPY' }, [])).toBe('Unbekannte Währung.')
    expect(incomingFromBody({ ...body, currency: undefined }, [])).toMatchObject({ netCents: 10000, currency: 'EUR', exchangeRate: null, originalNetCents: null })
  })
})
