import type { Pool } from 'mysql2/promise'
import { csvAmount, csvRow, day, INCOMING_CATEGORIES, percentText, splitCents } from '#shared/lib/erp'
import type { InvoiceRepository } from './invoices'
import { num, rows } from './sql'
import { zip, type ZipEntry } from './zip'

// Export and evaluation (module 7). The export is a ZIP for the tax adviser or the tax
// office: every issued document and received file of a period exactly as stored, plus
// CSV lists. The evaluation sums a year up; it is no bookkeeping, but it shows what an
// EÜR (cash basis) and the small-business limits of § 19 UStG need.

/** § 19 Abs. 1 UStG since 2025: previous year at most 25.000 €, current year at most 100.000 €. */
export const SMALL_BUSINESS_LIMITS = { previousYear: 2_500_000, currentYear: 10_000_000 }

const CSV_START = '﻿' // Excel recognizes UTF-8 by the byte order mark.
const csv = (header: string[], lines: (string | number | null)[][]) => Buffer.from(CSV_START + [header, ...lines].map(csvRow).join('\r\n') + '\r\n', 'utf8')
const safe = (text: string) => text.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80)

export async function exportArchive(pool: Pool, invoices: InvoiceRepository, from: string, to: string, now: Date): Promise<Buffer> {
  const entries: ZipEntry[] = []
  const date = now

  const outgoing = await rows<{ id: number, type: string, number: string, issueDate: string, deliveryDate: string, dueDate: string, buyer: string,
    net: number, tax: number, gross: number, preceding: string | null, partial: number, hash: string, paid: number }>(pool,
  `SELECT i.id, i.type, i.number, i.issue_date AS issueDate, i.delivery_date AS deliveryDate, i.due_date AS dueDate, i.buyer, i.net_cents AS net,
    i.tax_cents AS tax, i.gross_cents AS gross, p.number AS preceding, i.partial, i.hash,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments x WHERE x.invoice_id = i.id) AS paid
    FROM invoices i LEFT JOIN invoices p ON p.id = i.preceding_invoice_id
    WHERE i.status = 'final' AND i.issue_date BETWEEN ? AND ? ORDER BY i.chain_no`, [from, to])
  for (const inv of outgoing) {
    const docs = await rows<{ kind: string, content: Buffer }>(pool, 'SELECT kind, content FROM invoice_documents WHERE invoice_id = ?', [inv.id])
    for (const d of docs) entries.push({ name: `Ausgangsrechnungen/${inv.number}.${d.kind}`, content: d.content, date })
  }
  entries.push({
    name: 'ausgangsrechnungen.csv', date,
    content: csv(['Nummer', 'Art', 'Rechnungsdatum', 'Leistungsdatum', 'Fällig', 'Kunde', 'USt-IdNr. Kunde', 'Netto', 'USt', 'Brutto', 'Bezahlt', 'Bezieht sich auf', 'Prüfsumme'],
      outgoing.map((i) => {
        const buyer = JSON.parse(i.buyer) as { name: string, vatId?: string | null }
        return [i.number, i.type !== '381' ? 'Rechnung' : Number(i.partial) === 1 ? 'Rechnungskorrektur' : 'Stornorechnung', day(i.issueDate), day(i.deliveryDate), day(i.dueDate), buyer.name, buyer.vatId ?? null,
          csvAmount(num(i.net)), csvAmount(num(i.tax)), csvAmount(num(i.gross)), csvAmount(num(i.paid)), i.preceding, i.hash]
      })),
  })

  const payments = await rows<{ number: string, paidOn: string, amount: number, note: string | null }>(pool,
    `SELECT i.number, p.paid_on AS paidOn, p.amount_cents AS amount, p.note FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on, p.id`, [from, to])
  entries.push({ name: 'zahlungseingaenge.csv', date, content: csv(['Rechnung', 'Datum', 'Betrag', 'Notiz'], payments.map(p => [p.number, day(p.paidOn), csvAmount(num(p.amount)), p.note])) })

  const incoming = await rows<{ id: number, supplier: string, vatId: string | null, number: string, issueDate: string, dueDate: string | null, net: number, tax: number,
    gross: number, category: string, status: string, paidOn: string | null, reason: string | null, fileName: string, sha: string, format: string }>(pool,
  `SELECT i.id, s.name AS supplier, s.vat_id AS vatId, i.number, i.issue_date AS issueDate, i.due_date AS dueDate, i.net_cents AS net, i.tax_cents AS tax,
    i.gross_cents AS gross, i.category, i.status, i.paid_on AS paidOn, i.discarded_reason AS reason, i.file_name AS fileName,
    i.file_sha256 AS sha, i.format FROM incoming_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date, i.id`, [from, to])
  // "Projekt A (60 %), Projekt B (40 %)"; a single project without its 100 %.
  const projectNames = new Map<number, string[]>()
  for (const r of await rows<{ id: number, name: string, bp: unknown }>(pool, `SELECT a.incoming_invoice_id AS id, p.name, a.share_bp AS bp FROM incoming_invoice_projects a
    JOIN projects p ON p.id = a.project_id JOIN incoming_invoices i ON i.id = a.incoming_invoice_id WHERE i.issue_date BETWEEN ? AND ?
    ORDER BY a.share_bp DESC, p.name`, [from, to])) {
    const bp = num(r.bp)
    projectNames.set(r.id, [...(projectNames.get(r.id) ?? []), bp === 10000 ? r.name : `${r.name} (${percentText(bp)} %)`])
  }
  const incomingNames = new Map<number, string>()
  for (const inv of incoming) {
    const file = await rows<{ content: Buffer }>(pool, 'SELECT content FROM incoming_invoice_files WHERE incoming_invoice_id = ?', [inv.id])
    const extension = /\.([A-Za-z0-9]{1,5})$/.exec(inv.fileName)?.[1]?.toLowerCase() ?? 'bin'
    const name = `${inv.status === 'discarded' ? 'Eingangsrechnungen/verworfen' : 'Eingangsrechnungen'}/${inv.issueDate}_${safe(inv.supplier)}_${safe(inv.number)}_${inv.id}.${extension}`
    incomingNames.set(inv.id, name)
    if (file[0]) entries.push({ name, content: file[0].content, date })
  }
  entries.push({
    name: 'eingangsrechnungen.csv', date,
    content: csv(['Nr.', 'Lieferant', 'USt-IdNr.', 'Rechnungsnummer', 'Rechnungsdatum', 'Fällig', 'Netto', 'USt', 'Brutto', 'Kategorie', 'Projekt', 'Status', 'Bezahlt am', 'Verworfen weil', 'E-Rechnung', 'Datei', 'SHA-256'],
      incoming.map(i => [i.id, i.supplier, i.vatId, i.number, day(i.issueDate), i.dueDate ? day(i.dueDate) : null, csvAmount(num(i.net)), csvAmount(num(i.tax)), csvAmount(num(i.gross)),
        INCOMING_CATEGORIES[i.category] ?? i.category, projectNames.get(i.id)?.join(', ') ?? null, { open: 'offen', paid: 'bezahlt', discarded: 'verworfen' }[i.status] ?? i.status, i.paidOn ? day(i.paidOn) : null,
        i.reason, i.format === 'other' ? 'nein' : 'ja', incomingNames.get(i.id) ?? '', i.sha])),
  })

  const sales = await rows<{ id: number, number: string }>(pool, `SELECT id, number FROM sales_documents WHERE status <> 'draft' AND issue_date BETWEEN ? AND ? ORDER BY number`, [from, to])
  for (const s of sales) {
    const file = await rows<{ content: Buffer }>(pool, 'SELECT content FROM sales_files WHERE document_id = ?', [s.id])
    if (file[0]) entries.push({ name: `Angebote_und_Auftraege/${s.number}.pdf`, content: file[0].content, date })
  }

  const check = await invoices.verify()
  entries.unshift({
    name: 'LIESMICH.txt', date,
    content: Buffer.from([
      `Export aus dem Cockpit, Zeitraum ${day(from)} bis ${day(to)}, erstellt ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      '',
      'Ausgangsrechnungen/  ZUGFeRD-PDF (mit eingebetteter E-Rechnung) und XML jeder festgeschriebenen Rechnung, unverändert wie ausgestellt.',
      'Eingangsrechnungen/  Jede erhaltene Datei unverändert; verworfene (z. B. doppelt erfasste) im Unterordner verworfen/.',
      'Angebote_und_Auftraege/  Ausgestellte Angebote und Auftragsbestätigungen.',
      'ausgangsrechnungen.csv, zahlungseingaenge.csv, eingangsrechnungen.csv  Listen zum Öffnen in Excel (Semikolon, UTF-8).',
      '',
      'Unveränderbarkeit: Jede festgeschriebene Rechnung trägt eine SHA-256-Prüfsumme über die vorige Prüfsumme, ihre Nummer und die Prüfsummen von XML und PDF (Spalte Prüfsumme).',
      `Prüfung beim Export: ${check.count} Rechnungen, ${check.problems.length === 0 ? 'keine Abweichungen' : `Abweichungen: ${check.problems.join(' | ')}`}.`,
      '',
    ].join('\r\n'), 'utf8'),
  })
  return zip(entries)
}

export interface YearReport {
  year: number
  months: { month: number, invoiced: number, received: number, expensesPaid: number, expensesInvoiced: number }[]
  customers: { name: string, net: number }[]
  projects: { name: string, revenue: number, expenses: number }[]
  categories: { category: string, gross: number }[]
  totals: { invoicedNet: number, invoicedTax: number, received: number, expensesPaid: number, expensesInvoiced: number, openReceivables: number, openPayables: number }
  smallBusiness: { previousYearReceived: number, currentYearReceived: number, limits: typeof SMALL_BUSINESS_LIMITS }
}

/**
 * Sums of one year. "Invoiced" counts finalized invoices by invoice date, cancellations
 * negative; "received" counts payments by their date (cash basis, as the EÜR and the
 * § 19 UStG limits do: the Gesamtumsatz is computed from received payments, UStAE 19.2).
 */
export async function yearReport(pool: Pool, year: number): Promise<YearReport> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const signed = `CASE WHEN i.type = '381' THEN -1 ELSE 1 END`
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, invoiced: 0, received: 0, expensesPaid: 0, expensesInvoiced: 0 }))
  const byMonth = async (sql: string, key: keyof typeof months[number], params: unknown[] = [from, to]) => {
    for (const r of await rows<{ m: number, s: unknown }>(pool, sql, params)) months[r.m - 1]![key] = num(r.s)
  }
  await byMonth(`SELECT MONTH(i.issue_date) AS m, SUM(${signed} * i.net_cents) AS s FROM invoices i WHERE i.status = 'final' AND i.issue_date BETWEEN ? AND ? GROUP BY m`, 'invoiced')
  await byMonth('SELECT MONTH(paid_on) AS m, SUM(amount_cents) AS s FROM invoice_payments WHERE paid_on BETWEEN ? AND ? GROUP BY m', 'received')
  await byMonth(`SELECT MONTH(paid_on) AS m, SUM(gross_cents) AS s FROM incoming_invoices WHERE status = 'paid' AND paid_on BETWEEN ? AND ? GROUP BY m`, 'expensesPaid')
  await byMonth(`SELECT MONTH(issue_date) AS m, SUM(gross_cents) AS s FROM incoming_invoices WHERE status <> 'discarded' AND issue_date BETWEEN ? AND ? GROUP BY m`, 'expensesInvoiced')

  const customers = (await rows<{ name: string, net: unknown }>(pool, `SELECT c.name, SUM(${signed} * i.net_cents) AS net FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.status = 'final' AND i.issue_date BETWEEN ? AND ? GROUP BY c.id, c.name ORDER BY net DESC`, [from, to])).map(r => ({ name: r.name, net: num(r.net) }))

  const projectMap = new Map<string, { revenue: number, expenses: number }>()
  for (const r of await rows<{ name: string | null, s: unknown }>(pool, `SELECT p.name, SUM(${signed} * i.net_cents) AS s FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.status = 'final' AND i.issue_date BETWEEN ? AND ? GROUP BY p.name`, [from, to])) {
    projectMap.set(r.name ?? 'ohne Projekt', { revenue: num(r.s), expenses: 0 })
  }
  // An incoming invoice split across projects counts for each with its share of the net
  // amount; the parts of one invoice add up to its net exactly (splitCents).
  const shares = new Map<number, { net: number, parts: { name: string | null, bp: number }[] }>()
  for (const r of await rows<{ id: number, net: unknown, name: string | null, bp: unknown }>(pool, `SELECT i.id, i.net_cents AS net, p.name, a.share_bp AS bp
    FROM incoming_invoices i LEFT JOIN incoming_invoice_projects a ON a.incoming_invoice_id = i.id LEFT JOIN projects p ON p.id = a.project_id
    WHERE i.status <> 'discarded' AND i.issue_date BETWEEN ? AND ? ORDER BY i.id, a.share_bp DESC, a.project_id`, [from, to])) {
    const entry = shares.get(r.id) ?? { net: num(r.net), parts: [] }
    entry.parts.push({ name: r.name, bp: r.bp === null ? 10000 : num(r.bp) })
    shares.set(r.id, entry)
  }
  for (const { net, parts } of shares.values()) {
    splitCents(net, parts.map(p => p.bp)).forEach((cents, k) => {
      const key = parts[k]!.name ?? 'ohne Projekt'
      const known = projectMap.get(key) ?? { revenue: 0, expenses: 0 }
      projectMap.set(key, { revenue: known.revenue, expenses: known.expenses + cents })
    })
  }
  const projects = [...projectMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue)

  const categories = (await rows<{ category: string, gross: unknown }>(pool, `SELECT category, SUM(gross_cents) AS gross FROM incoming_invoices
    WHERE status <> 'discarded' AND issue_date BETWEEN ? AND ? GROUP BY category ORDER BY gross DESC`, [from, to])).map(r => ({ category: r.category, gross: num(r.gross) }))

  const [sums] = await rows<{ net: unknown, tax: unknown }>(pool, `SELECT SUM(${signed} * i.net_cents) AS net, SUM(${signed} * i.tax_cents) AS tax FROM invoices i
    WHERE i.status = 'final' AND i.issue_date BETWEEN ? AND ?`, [from, to])
  // Open at the end of the year (or today, for the current year): finalized, not cancelled,
  // gross minus payments minus Rechnungskorrekturen up to that day, where that is above 0.
  const [open] = await rows<{ s: unknown }>(pool, `SELECT SUM(GREATEST(0, i.gross_cents
      - (SELECT COALESCE(SUM(amount_cents), 0) FROM invoice_payments x WHERE x.invoice_id = i.id AND x.paid_on <= ?)
      - (SELECT COALESCE(SUM(k.gross_cents), 0) FROM invoices k WHERE k.preceding_invoice_id = i.id AND k.type = '381' AND k.partial = 1
          AND k.status = 'final' AND k.issue_date <= ?))) AS s
    FROM invoices i WHERE i.status = 'final' AND i.type = '380' AND i.issue_date <= ?
    AND NOT EXISTS (SELECT 1 FROM invoices s WHERE s.preceding_invoice_id = i.id AND s.partial = 0 AND s.status = 'final' AND s.issue_date <= ?)`, [to, to, to, to])
  const [payables] = await rows<{ s: unknown }>(pool, `SELECT SUM(gross_cents) AS s FROM incoming_invoices WHERE status <> 'discarded' AND issue_date <= ?
    AND (paid_on IS NULL OR paid_on > ?)`, [to, to])
  const received = async (y: number) => num((await rows<{ s: unknown }>(pool, 'SELECT SUM(amount_cents) AS s FROM invoice_payments WHERE YEAR(paid_on) = ?', [y]))[0]?.s)

  return {
    year, months, customers, projects,
    categories,
    totals: {
      invoicedNet: num(sums?.net), invoicedTax: num(sums?.tax), received: months.reduce((s, m) => s + m.received, 0),
      expensesPaid: months.reduce((s, m) => s + m.expensesPaid, 0), expensesInvoiced: months.reduce((s, m) => s + m.expensesInvoiced, 0),
      openReceivables: num(open?.s), openPayables: num(payables?.s),
    },
    smallBusiness: { previousYearReceived: await received(year - 1), currentYearReceived: await received(year), limits: SMALL_BUSINESS_LIMITS },
  }
}
