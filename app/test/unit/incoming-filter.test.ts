import { describe, expect, it } from 'vitest'
import { emptyFilter, isFiltered, matchesIncoming } from '../../shared/lib/incomingFilter'
import type { IncomingInvoice } from '../../shared/types/erp'

const invoice = (over: Partial<IncomingInvoice>): IncomingInvoice => ({
  id: 1, supplierId: 3, supplierName: 'Anthropic, PBC', number: 'ABCD-0007', issueDate: '2026-11-03', dueDate: null, netCents: 10000, taxCents: 1900,
  grossCents: 11900, currency: 'EUR', originalNetCents: null, originalTaxCents: null, exchangeRate: null, kind: 'invoice', relatedId: null,
  status: 'open', category: 'software', projectId: 1, projects: [{ projectId: 1, shareBp: 10000 }], iban: null, note: 'Claude Max', format: 'other',
  fileName: 'Invoice-ABCD.pdf', fileType: 'application/pdf', paidOn: null, paidCents: null, discardedReason: null, createdAt: '2026-11-03 10:00:00',
  ...over,
} as IncomingInvoice)

describe('filtering incoming invoices', () => {
  const all = { ...emptyFilter(), status: 'all' as const }

  it('searches supplier, number, note and amounts, every word must match', () => {
    expect(matchesIncoming(invoice({}), { ...all, query: 'anthropic' })).toBe(true)
    expect(matchesIncoming(invoice({}), { ...all, query: 'abcd-0007' })).toBe(true)
    expect(matchesIncoming(invoice({}), { ...all, query: 'claude max' })).toBe(true)
    expect(matchesIncoming(invoice({}), { ...all, query: '119,00' })).toBe(true)
    expect(matchesIncoming(invoice({}), { ...all, query: 'anthropic hetzner' })).toBe(false)
    expect(matchesIncoming(invoice({ supplierName: 'Müller GmbH' }), { ...all, query: 'muller' })).toBe(true)
  })

  it('filters by status, kind, supplier, category, project and date range', () => {
    const i = invoice({})
    expect(matchesIncoming(i, emptyFilter())).toBe(true)
    expect(matchesIncoming(invoice({ status: 'paid' }), emptyFilter())).toBe(false)
    expect(matchesIncoming(i, { ...all, kind: 'credit' })).toBe(false)
    expect(matchesIncoming(i, { ...all, supplierId: '3' })).toBe(true)
    expect(matchesIncoming(i, { ...all, supplierId: '4' })).toBe(false)
    expect(matchesIncoming(i, { ...all, category: 'hosting' })).toBe(false)
    expect(matchesIncoming(i, { ...all, projectId: '1' })).toBe(true)
    expect(matchesIncoming(i, { ...all, projectId: 'none' })).toBe(false)
    expect(matchesIncoming(invoice({ projects: [] }), { ...all, projectId: 'none' })).toBe(true)
    expect(matchesIncoming(i, { ...all, from: '2026-11-01', to: '2026-11-30' })).toBe(true)
    expect(matchesIncoming(i, { ...all, from: '2026-11-04' })).toBe(false)
    expect(matchesIncoming(i, { ...all, to: '2026-11-02' })).toBe(false)
    expect(isFiltered(emptyFilter())).toBe(false)
    expect(isFiltered({ ...emptyFilter(), query: ' x ' })).toBe(true)
  })
})
