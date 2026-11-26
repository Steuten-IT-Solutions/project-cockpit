import { createHash } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import { addDays, documentNumber, type Line, SMALL_BUSINESS_NOTE, totals } from '#shared/lib/erp'
import type { SalesDocument } from '#shared/types/erp'
import type { InvoiceEngine, RenderDocument } from './engine'
import type { DocumentHead } from './forms'
import { InvoiceError, type InvoiceRepository, render } from './invoices'
import { MasterData } from './masterData'
import { exec, LINE_COLUMNS, num, one, rows, type Sql, transaction } from './sql'

// Quotes (Angebote, A-2026-0001) and order confirmations (Auftragsbestätigungen,
// AB-2026-0001), module 5. Like invoices they are drafts until issued; issuing assigns
// the number and stores the PDF as sent. A quote can become an order, an order (or an
// accepted quote) an invoice draft. They are not e-invoices, so there is no XML.

export type SalesKind = 'quote' | 'order'

export interface SalesInput extends DocumentHead {
  validUntil: string | null
  deliveryDate: string | null
  lines: Line[]
}

const COLUMNS = `d.id, d.kind, d.status, d.number, d.customer_id AS customerId, c.name AS customerName, c.email AS customerEmail,
  d.project_id AS projectId, d.issue_date AS issueDate, d.valid_until AS validUntil, d.delivery_date AS deliveryDate, d.note,
  d.quote_id AS quoteId, q.number AS quoteNumber, d.invoice_id AS invoiceId, i.number AS invoiceNumber,
  (SELECT o.id FROM sales_documents o WHERE o.quote_id = d.id ORDER BY o.id LIMIT 1) AS orderId,
  d.net_cents AS netCents, d.tax_cents AS taxCents, d.gross_cents AS grossCents`
const FROM = `FROM sales_documents d JOIN customers c ON c.id = d.customer_id
  LEFT JOIN sales_documents q ON q.id = d.quote_id LEFT JOIN invoices i ON i.id = d.invoice_id`

type Row = Omit<SalesDocument, 'lines'>
const amounts = (r: Row): Row => ({ ...r, netCents: num(r.netCents), taxCents: num(r.taxCents), grossCents: num(r.grossCents) })

export class SalesRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Omit<SalesDocument, 'lines'>[]> {
    return (await rows<Row>(this.pool, `SELECT ${COLUMNS} ${FROM} ORDER BY d.status = 'draft' DESC, d.issue_date DESC, d.id DESC`)).map(amounts)
  }

  async find(id: number, db: Sql = this.pool): Promise<SalesDocument | null> {
    const row = await one<Row>(db, `SELECT ${COLUMNS} ${FROM} WHERE d.id = ?`, [id])
    return row === null ? null : { ...amounts(row), lines: await this.lines(id, db) }
  }

  private lines(id: number, db: Sql = this.pool): Promise<Line[]> {
    return rows<Line>(db, `SELECT ${LINE_COLUMNS} FROM sales_lines WHERE document_id = ? ORDER BY position, id`, [id])
  }

  async create(kind: SalesKind, d: SalesInput, now: string, quoteId: number | null = null, db: Sql = this.pool): Promise<number> {
    const t = totals(d.lines)
    const id = (await exec(db, `INSERT INTO sales_documents (kind, status, customer_id, project_id, valid_until, delivery_date, note, quote_id,
      net_cents, tax_cents, gross_cents, created_at, updated_at) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, d.customerId, d.projectId, d.validUntil, d.deliveryDate, d.note, quoteId, t.net, t.tax, t.gross, now, now])).insertId
    await this.writeLines(db, id, d.lines)
    return id
  }

  async update(id: number, d: SalesInput, now: string): Promise<boolean> {
    return transaction(this.pool, async (db) => {
      const current = await one<{ status: string }>(db, 'SELECT status FROM sales_documents WHERE id = ? FOR UPDATE', [id])
      if (current?.status !== 'draft') return false
      const t = totals(d.lines)
      await exec(db, `UPDATE sales_documents SET customer_id = ?, project_id = ?, valid_until = ?, delivery_date = ?, note = ?,
        net_cents = ?, tax_cents = ?, gross_cents = ?, updated_at = ? WHERE id = ?`,
      [d.customerId, d.projectId, d.validUntil, d.deliveryDate, d.note, t.net, t.tax, t.gross, now, id])
      await exec(db, 'DELETE FROM sales_lines WHERE document_id = ?', [id])
      await this.writeLines(db, id, d.lines)
      return true
    })
  }

  async delete(id: number): Promise<boolean> {
    return transaction(this.pool, async (db) => {
      const current = await one<{ status: string }>(db, 'SELECT status FROM sales_documents WHERE id = ? FOR UPDATE', [id])
      if (current?.status !== 'draft') return false
      await exec(db, 'UPDATE time_entries SET order_id = NULL WHERE order_id = ?', [id])
      await exec(db, 'DELETE FROM sales_documents WHERE id = ?', [id])
      return true
    })
  }

  private async writeLines(db: Sql, id: number, lines: Line[]): Promise<void> {
    for (const [i, l] of lines.entries()) {
      await exec(db, `INSERT INTO sales_lines (document_id, position, name, description, quantity_milli, unit, unit_price_cents, vat_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, i + 1, l.name, l.description, l.quantityMilli, l.unit, l.unitPriceCents, l.vatRate])
    }
  }

  /** The PDF of a quote or order: as a draft (watermark) or for issuing. */
  private async document(doc: SalesDocument, number: string, issueDate: string, draft: boolean, master: MasterData, db: Sql): Promise<RenderDocument> {
    const [settings, logo, customer] = await Promise.all([master.settings(), master.logo(), new MasterData(db).customer(doc.customerId)])
    if (settings === null) throw new InvoiceError('Bitte trage zuerst deine Firmendaten unter ERP → Einstellungen ein.')
    if (customer === null) throw new InvoiceError('Der Kunde existiert nicht mehr.')
    if (doc.lines.length === 0) throw new InvoiceError('Das Dokument hat keine Positionen.')
    if (settings.smallBusiness && doc.lines.some(l => l.vatRate !== 0)) throw new InvoiceError('Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG).')
    // The PHP side checks dates as for an invoice (due date not before the issue date).
    const validUntil = doc.validUntil !== null && doc.validUntil >= issueDate ? doc.validUntil : addDays(issueDate, 30)
    const delivery = doc.deliveryDate ?? issueDate
    const { iban, bic, bankName: _bank, ...seller } = MasterData.seller(settings)
    return {
      mode: draft ? 'draft' : doc.kind, number, issueDate,
      deliveryDate: delivery,
      dueDate: doc.kind === 'quote' ? validUntil : (delivery >= issueDate ? delivery : issueDate),
      seller, buyer: MasterData.buyer(customer), lines: doc.lines, smallBusiness: settings.smallBusiness, iban, bic,
      exemptionReason: settings.smallBusiness ? SMALL_BUSINESS_NOTE : settings.exemptionReason, note: doc.note,
      logo: logo === null ? null : { data: logo.data.toString('base64'), type: logo.type },
    }
  }

  async preview(id: number, engine: InvoiceEngine, master: MasterData, today: string): Promise<Buffer> {
    const doc = await this.find(id)
    if (doc === null) throw new InvoiceError('Das Dokument existiert nicht.')
    return (await render(engine, await this.document(doc, 'ENTWURF', today, true, master, this.pool))).pdf
  }

  /** Assigns the number, renders and stores the PDF; returns the number. */
  async issue(id: number, engine: InvoiceEngine, master: MasterData, today: string, now: string): Promise<string> {
    const year = Number(today.slice(0, 4))
    const head = await one<{ kind: SalesKind }>(this.pool, 'SELECT kind FROM sales_documents WHERE id = ?', [id])
    if (head === null) throw new InvoiceError('Das Dokument existiert nicht.')
    await exec(this.pool, 'INSERT IGNORE INTO number_sequences (kind, year, next_value) VALUES (?, ?, 1)', [head.kind, year])
    return transaction(this.pool, async (db) => {
      const locked = await one<{ status: string }>(db, 'SELECT status FROM sales_documents WHERE id = ? FOR UPDATE', [id])
      if (locked?.status !== 'draft') throw new InvoiceError('Das Dokument ist bereits ausgestellt.')
      const doc = (await this.find(id, db))!
      const sequence = await one<{ next: number }>(db, 'SELECT next_value AS next FROM number_sequences WHERE kind = ? AND year = ? FOR UPDATE', [head.kind, year])
      const number = documentNumber(head.kind, year, sequence!.next)
      const { pdf } = await render(engine, await this.document(doc, number, today, false, master, db))
      await exec(db, 'INSERT INTO sales_files (document_id, content, sha256, created_at) VALUES (?, ?, ?, ?)', [id, pdf, createHash('sha256').update(pdf).digest('hex'), now])
      const validUntil = doc.kind === 'quote' ? (doc.validUntil !== null && doc.validUntil >= today ? doc.validUntil : addDays(today, 30)) : doc.validUntil
      await exec(db, `UPDATE sales_documents SET status = 'sent', number = ?, issue_date = ?, valid_until = ?, issued_at = ?, updated_at = ? WHERE id = ?`,
        [number, today, validUntil, now, now, id])
      await exec(db, 'UPDATE number_sequences SET next_value = next_value + 1 WHERE kind = ? AND year = ?', [head.kind, year])
      return number
    })
  }

  async file(id: number): Promise<{ content: Buffer, number: string } | null> {
    return one(this.pool, 'SELECT f.content, d.number FROM sales_files f JOIN sales_documents d ON d.id = f.document_id WHERE f.document_id = ?', [id])
  }

  /** accepted or rejected, for an issued quote. */
  async decide(id: number, status: 'accepted' | 'rejected' | 'sent', now: string): Promise<boolean> {
    const result = await exec(this.pool, `UPDATE sales_documents SET status = ?, updated_at = ? WHERE id = ? AND kind = 'quote' AND status IN ('sent', 'accepted', 'rejected') AND invoice_id IS NULL`, [status, now, id])
    return result.affectedRows > 0
  }

  /** An order confirmation draft from an issued quote, which counts as accepted. */
  async orderFromQuote(quoteId: number, today: string, now: string): Promise<number> {
    return transaction(this.pool, async (db) => {
      const quote = await this.find(quoteId, db)
      if (quote === null || quote.kind !== 'quote' || quote.status === 'draft') throw new InvoiceError('Nur ausgestellte Angebote können beauftragt werden.')
      if (quote.orderId !== null) throw new InvoiceError('Zu diesem Angebot gibt es schon eine Auftragsbestätigung.')
      await exec(db, `UPDATE sales_documents SET status = 'accepted', updated_at = ? WHERE id = ?`, [now, quoteId])
      return this.create('order', { customerId: quote.customerId, projectId: quote.projectId, note: quote.note, validUntil: null, deliveryDate: today, lines: quote.lines }, now, quoteId, db)
    })
  }

  /** An invoice draft from an issued order or an accepted quote. */
  async toInvoice(id: number, invoices: InvoiceRepository, today: string, paymentDays: number, now: string): Promise<number> {
    return transaction(this.pool, async (db) => {
      await one(db, 'SELECT id FROM sales_documents WHERE id = ? FOR UPDATE', [id])
      const doc = await this.find(id, db)
      if (doc === null || doc.status === 'draft') throw new InvoiceError('Bitte stelle das Dokument zuerst aus.')
      if (doc.invoiceId !== null) throw new InvoiceError(`Daraus wurde bereits eine Rechnung erstellt${doc.invoiceNumber ? ` (${doc.invoiceNumber})` : ''}.`)
      if (doc.kind === 'quote' && doc.status === 'rejected') throw new InvoiceError('Das Angebot wurde abgelehnt.')
      const label = doc.kind === 'order' ? 'Auftrag' : 'Angebot'
      const invoiceId = await invoices.createDraft({
        customerId: doc.customerId, projectId: doc.projectId, deliveryDate: doc.deliveryDate !== null && doc.deliveryDate <= today ? doc.deliveryDate : today,
        paymentDays, note: [`${label} ${doc.number} vom ${doc.issueDate!.split('-').reverse().join('.')}`, doc.note].filter(v => v).join('\n'),
        lines: doc.lines, source: { type: doc.kind, id },
      }, now, db)
      await exec(db, `UPDATE sales_documents SET invoice_id = ?, status = ?, updated_at = ? WHERE id = ?`, [invoiceId, doc.kind === 'order' ? 'invoiced' : 'accepted', now, id])
      return invoiceId
    })
  }
}
