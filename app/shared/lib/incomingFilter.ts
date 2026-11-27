import type { IncomingInvoice } from '../types/erp'
import { priceText } from './erp'

// Search and filters of the incoming invoices list. Pure, so it is unit tested and the page
// filters the already loaded list without asking the server again.

export interface IncomingFilter {
  /** Free text: supplier, number, note, file name or an amount such as "23,80". */
  query: string
  status: 'all' | 'open' | 'paid' | 'discarded'
  kind: 'all' | 'invoice' | 'credit'
  /** Supplier id as text; '' for all. */
  supplierId: string
  /** Category key; '' for all. */
  category: string
  /** Project id as text, 'none' for invoices without project, '' for all. */
  projectId: string
  /** Invoice date range as ISO dates; '' for open-ended. */
  from: string
  to: string
}

export const emptyFilter = (): IncomingFilter => ({ query: '', status: 'open', kind: 'all', supplierId: '', category: '', projectId: '', from: '', to: '' })

/** Lower case without accents, so "muller" also finds "Müller". */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
}

export function matchesIncoming(i: IncomingInvoice, f: IncomingFilter): boolean {
  if (f.status !== 'all' && i.status !== f.status) return false
  if (f.kind !== 'all' && i.kind !== f.kind) return false
  if (f.supplierId !== '' && String(i.supplierId) !== f.supplierId) return false
  if (f.category !== '' && i.category !== f.category) return false
  if (f.projectId === 'none' && i.projects.length > 0) return false
  if (f.projectId !== '' && f.projectId !== 'none' && !i.projects.some(p => String(p.projectId) === f.projectId)) return false
  if (f.from !== '' && i.issueDate < f.from) return false
  if (f.to !== '' && i.issueDate > f.to) return false
  const words = fold(f.query).split(/\s+/).filter(w => w !== '')
  if (words.length === 0) return true
  const haystack = fold([i.supplierName, i.number, i.note ?? '', i.fileName, priceText(i.grossCents), priceText(i.netCents)].join(' '))
  // Every word must occur somewhere, e.g. "anthropic 2026" or "hoster 119".
  return words.every(w => haystack.includes(w))
}

/** Whether any filter beyond status and kind is set, to offer "Filter zurücksetzen". */
export function isFiltered(f: IncomingFilter): boolean {
  return f.query.trim() !== '' || f.supplierId !== '' || f.category !== '' || f.projectId !== '' || f.from !== '' || f.to !== ''
}
