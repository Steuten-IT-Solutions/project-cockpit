import { createHash } from 'node:crypto'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { addDays, documentNumber, euro, invoiceState, type Line, SMALL_BUSINESS_NOTE, totals } from '#shared/lib/erp'
import type { CompanySettings, InvoiceDetail, InvoiceEvent, InvoiceSummary, Payment, Reminder } from '#shared/types/erp'
import { EngineInputError, type InvoiceEngine, type PartyDocument, type RenderDocument } from './engine'
import { MasterData } from './masterData'
import { exec, LINE_COLUMNS, num, one, rows, type Sql, transaction } from './sql'

// Outgoing invoices (module 1). A draft can be changed freely. Finalizing gives it the
// next number, freezes seller and buyer, renders the ZUGFeRD PDF and the XML once and
// stores them; from then on the database refuses any change (triggers in 0013). The
// stored files are what was issued, so a download always returns the same bytes.
// Mistakes are corrected with a cancellation (Stornorechnung, type 381) of the whole
// invoice, or with a Rechnungskorrektur (also 381, partial = 1) that credits only some
// positions or amounts: the invoice stays valid and its open amount shrinks by it.

/** A message for the user (422), e.g. missing company data. */
export class InvoiceError extends Error {}

export interface DraftInput {
  customerId: number
  projectId: number | null
  deliveryDate: string
  paymentDays: number
  note: string | null
  lines: Line[]
  source?: { type: string, id: number } | null
}

export type Seller = PartyDocument & { iban: string, bic: string | null, bankName: string | null }

const SUMMARY = `SELECT i.id, i.type, i.status, i.number, i.customer_id AS customerId, c.name AS customerName, i.project_id AS projectId,
  i.issue_date AS issueDate, i.delivery_date AS deliveryDate, i.due_date AS dueDate, i.net_cents AS netCents, i.tax_cents AS taxCents,
  i.gross_cents AS grossCents, i.payment_days AS paymentDays, i.note, i.hash, c.email AS customerEmail,
  (SELECT COALESCE(SUM(p.amount_cents), 0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS paidCents,
  (SELECT COALESCE(MAX(r.level), 0) FROM invoice_reminders r WHERE r.invoice_id = i.id) AS reminderLevel,
  (SELECT MAX(e.created_at) FROM invoice_events e WHERE e.invoice_id = i.id AND e.event = 'sent') AS sentAt,
  pre.number AS precedingNumber, i.partial AS correction,
  (SELECT s.number FROM invoices s WHERE s.preceding_invoice_id = i.id AND s.type = '381' AND s.partial = 0 AND s.status = 'final' ORDER BY s.id LIMIT 1) AS cancelledBy,
  (SELECT COALESCE(SUM(s.gross_cents), 0) FROM invoices s WHERE s.preceding_invoice_id = i.id AND s.type = '381' AND s.partial = 1 AND s.status = 'final') AS creditedCents
  FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN invoices pre ON pre.id = i.preceding_invoice_id`

type SummaryRow = Omit<InvoiceSummary, 'state' | 'correction'> & { correction: number | boolean, paymentDays: number, note: string | null, hash: string | null, customerEmail: string | null }

function summary(row: SummaryRow, today: string): Omit<SummaryRow, 'correction'> & { correction: boolean, state: InvoiceSummary['state'] } {
  const paidCents = num(row.paidCents)
  const reminderLevel = num(row.reminderLevel)
  const creditedCents = num(row.creditedCents)
  const correction = Number(row.correction) === 1
  return {
    ...row, paidCents, creditedCents, correction, reminderLevel, netCents: num(row.netCents), taxCents: num(row.taxCents), grossCents: num(row.grossCents),
    state: invoiceState({ ...row, paidCents, creditedCents, correction, cancelled: row.cancelledBy !== null }, today),
  }
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

/** The chain link of a finalized invoice: SHA-256 of "prev_hash|number|sha256(xml)|sha256(pdf)". */
export function chainHash(prevHash: string | null, number: string, xmlSha: string, pdfSha: string): string {
  return sha256(`${prevHash ?? ''}|${number}|${xmlSha}|${pdfSha}`)
}

/** Checks a draft against the rules PHP would refuse, with German messages. */
export function finalizeProblem(lines: Line[], settings: CompanySettings | null, smallBusiness: boolean, exemptionReason: string | null): string | null {
  if (settings === null) return 'Bitte trage zuerst deine Firmendaten unter ERP → Einstellungen ein.'
  if (lines.length === 0) return 'Die Rechnung hat keine Positionen.'
  if (smallBusiness && lines.some(l => l.vatRate !== 0)) return 'Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG). Bitte setze alle Positionen auf 0 %.'
  if (!smallBusiness && lines.some(l => l.vatRate === 0) && (exemptionReason ?? '').trim() === '') {
    return 'Für Positionen mit 0 % braucht die Rechnung einen Befreiungsgrund (Einstellungen).'
  }
  return null
}

/**
 * Checks the positions of a Rechnungskorrektur against the invoice: only its VAT rates
 * (the correction reduces the tax of exactly those rates, § 17 UStG), a positive amount,
 * and together with earlier corrections at most the invoice's gross amount.
 */
export function correctionProblem(invoiceLines: Line[], lines: Line[], remainingGross: number, smallBusiness: boolean): string | null {
  if (lines.length === 0) return 'Bitte wähle mindestens eine Position aus.'
  if (smallBusiness && lines.some(l => l.vatRate !== 0)) return 'Als Kleinunternehmer darfst du keine Umsatzsteuer ausweisen (§ 19 UStG).'
  const rates = new Set(invoiceLines.map(l => l.vatRate))
  const foreign = lines.find(l => !rates.has(l.vatRate))
  if (foreign !== undefined) return `„${foreign.name}“: Die Rechnung hat keine Position mit ${foreign.vatRate} % Umsatzsteuer.`
  const gross = totals(lines).gross
  if (gross <= 0) return 'Die Rechnungskorrektur muss einen Betrag größer als 0 haben.'
  if (gross > remainingGross) {
    return `Die Korrektur (${euro(gross)}) ist höher als der noch nicht gutgeschriebene Betrag der Rechnung (${euro(remainingGross)}).`
  }
  return null
}

export class InvoiceRepository {
  constructor(private readonly pool: Pool) {}

  async list(today: string): Promise<InvoiceSummary[]> {
    const list = await rows<SummaryRow>(this.pool, `${SUMMARY} ORDER BY i.status = 'draft' DESC, i.issue_date DESC, i.number DESC, i.id DESC`)
    return list.map(r => summary(r, today))
  }

  async find(id: number, today: string): Promise<InvoiceDetail | null> {
    const row = await one<SummaryRow>(this.pool, `${SUMMARY} WHERE i.id = ?`, [id])
    if (row === null) return null
    const [lines, events, payments, reminders, entries, related] = await Promise.all([
      this.lines(id),
      rows<InvoiceEvent>(this.pool, 'SELECT event, detail, created_at AS createdAt FROM invoice_events WHERE invoice_id = ? ORDER BY id', [id]),
      rows<Payment>(this.pool, 'SELECT id, paid_on AS paidOn, amount_cents AS amountCents, note FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_on, id', [id]),
      rows<Reminder>(this.pool, 'SELECT id, level, sent_on AS sentOn, new_due_date AS newDueDate, recipient FROM invoice_reminders WHERE invoice_id = ? ORDER BY level, id', [id]),
      rows<{ id: number }>(this.pool, 'SELECT id FROM time_entries WHERE invoice_id = ? ORDER BY work_date, id', [id]),
      rows<{ id: number, number: string, issueDate: string, grossCents: number, correction: number }>(this.pool,
        `SELECT id, number, issue_date AS issueDate, gross_cents AS grossCents, partial AS correction FROM invoices
        WHERE status = 'final' AND (preceding_invoice_id = ? OR id = (SELECT preceding_invoice_id FROM invoices WHERE id = ?)) ORDER BY chain_no`, [id, id]),
    ])
    return {
      ...summary(row, today), lines, events, reminders,
      payments: payments.map(p => ({ ...p, amountCents: num(p.amountCents) })),
      timeEntryIds: entries.map(e => e.id),
      related: related.map(r => ({ ...r, grossCents: num(r.grossCents), correction: Number(r.correction) === 1 })),
    }
  }

  async lines(id: number, db: Sql = this.pool): Promise<Line[]> {
    return rows<Line>(db, `SELECT ${LINE_COLUMNS} FROM invoice_lines WHERE invoice_id = ? ORDER BY position, id`, [id])
  }

  async createDraft(d: DraftInput, now: string, db: Sql = this.pool): Promise<number> {
    const t = totals(d.lines)
    const result = await exec(db, `INSERT INTO invoices (type, status, customer_id, project_id, delivery_date, payment_days, note, source_type, source_id,
      net_cents, tax_cents, gross_cents, created_at, updated_at) VALUES ('380', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.customerId, d.projectId, d.deliveryDate, d.paymentDays, d.note, d.source?.type ?? null, d.source?.id ?? null, t.net, t.tax, t.gross, now, now])
    await this.writeLines(db, result.insertId, d.lines)
    await this.event(db, result.insertId, 'created', d.source ? `aus ${d.source.type} ${d.source.id}` : null, now)
    return result.insertId
  }

  /** false if the invoice is no draft (any more). */
  async updateDraft(id: number, d: DraftInput, now: string): Promise<boolean> {
    return transaction(this.pool, async (db) => {
      const current = await one<{ status: string }>(db, 'SELECT status FROM invoices WHERE id = ? FOR UPDATE', [id])
      if (current?.status !== 'draft') return false
      const t = totals(d.lines)
      await exec(db, `UPDATE invoices SET customer_id = ?, project_id = ?, delivery_date = ?, payment_days = ?, note = ?,
        net_cents = ?, tax_cents = ?, gross_cents = ?, updated_at = ? WHERE id = ?`,
      [d.customerId, d.projectId, d.deliveryDate, d.paymentDays, d.note, t.net, t.tax, t.gross, now, id])
      await exec(db, 'DELETE FROM invoice_lines WHERE invoice_id = ?', [id])
      await this.writeLines(db, id, d.lines)
      return true
    })
  }

  /** Deletes a draft; billed time entries and orders become open again. */
  async deleteDraft(id: number): Promise<boolean> {
    return transaction(this.pool, async (db) => {
      const current = await one<{ status: string }>(db, 'SELECT status FROM invoices WHERE id = ? FOR UPDATE', [id])
      if (current?.status !== 'draft') return false
      await exec(db, 'UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?', [id])
      await exec(db, `UPDATE sales_documents SET invoice_id = NULL, status = 'sent' WHERE invoice_id = ? AND kind = 'order'`, [id])
      await exec(db, `UPDATE sales_documents SET invoice_id = NULL WHERE invoice_id = ? AND kind = 'quote'`, [id])
      await exec(db, 'DELETE FROM invoice_events WHERE invoice_id = ?', [id])
      await exec(db, 'DELETE FROM invoices WHERE id = ?', [id])
      return true
    })
  }

  private async writeLines(db: Sql, invoiceId: number, lines: Line[]): Promise<void> {
    for (const [i, l] of lines.entries()) {
      await exec(db, `INSERT INTO invoice_lines (invoice_id, position, name, description, quantity_milli, unit, unit_price_cents, vat_rate, discount_bp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [invoiceId, i + 1, l.name, l.description, l.quantityMilli, l.unit, l.unitPriceCents, l.vatRate, l.discountBp])
    }
  }

  async event(db: Sql, invoiceId: number, event: string, detail: string | null, now: string): Promise<void> {
    await exec(db, 'INSERT INTO invoice_events (invoice_id, event, detail, created_at) VALUES (?, ?, ?, ?)', [invoiceId, event, detail?.slice(0, 500) ?? null, now])
  }

  /** The draft as a PDF with the watermark ENTWURF; nothing is stored. */
  async preview(id: number, engine: InvoiceEngine, master: MasterData, today: string): Promise<Buffer> {
    const draft = await one<{ status: string, customerId: number, deliveryDate: string, paymentDays: number, note: string | null }>(this.pool,
      'SELECT status, customer_id AS customerId, delivery_date AS deliveryDate, payment_days AS paymentDays, note FROM invoices WHERE id = ?', [id])
    if (draft === null) throw new InvoiceError('Die Rechnung existiert nicht.')
    const [settings, customer, lines, logo] = await Promise.all([master.settings(), master.customer(draft.customerId), this.lines(id), master.logo()])
    const problem = finalizeProblem(lines, settings, settings?.smallBusiness ?? true, settings?.exemptionReason ?? null)
    if (problem !== null) throw new InvoiceError(problem)
    if (customer === null) throw new InvoiceError('Der Kunde existiert nicht mehr.')
    const document = this.document('draft', 'ENTWURF', today, draft.deliveryDate, addDays(today, draft.paymentDays), MasterData.seller(settings!),
      MasterData.buyer(customer), lines, settings!, draft.note, logo)
    return (await render(engine, document)).pdf
  }

  private document(mode: RenderDocument['mode'], number: string, issueDate: string, deliveryDate: string, dueDate: string, seller: Seller,
    buyer: PartyDocument, lines: Line[], tax: { smallBusiness: boolean, exemptionReason: string | null }, note: string | null,
    logo: { data: Buffer, type: string } | null, type: '380' | '381' = '380', precedingNumber: string | null = null, correction = false): RenderDocument {
    const { iban, bic, bankName: _bank, ...party } = seller
    return {
      mode, number, type, issueDate, deliveryDate, dueDate, seller: party, buyer, lines, iban, bic, note, precedingNumber, correction,
      smallBusiness: tax.smallBusiness,
      exemptionReason: tax.smallBusiness ? SMALL_BUSINESS_NOTE : tax.exemptionReason,
      logo: logo === null ? null : { data: logo.data.toString('base64'), type: logo.type },
    }
  }

  /**
   * Creates the counter rows outside the transaction. Inside it, two requests that both
   * inserted (or found) the row would each hold a shared lock and deadlock on FOR UPDATE.
   */
  private async ensureSequences(today: string): Promise<void> {
    await exec(this.pool, `INSERT IGNORE INTO number_sequences (kind, year, next_value) VALUES ('chain', 0, 1), ('invoice', ?, 1)`, [Number(today.slice(0, 4))])
  }

  /**
   * Finalizes a draft: number, frozen parties, PDF and XML, hash chain, all in one
   * transaction. Returns the number.
   */
  async finalize(id: number, engine: InvoiceEngine, master: MasterData, today: string, now: string): Promise<string> {
    const [settings, logo] = await Promise.all([master.settings(), master.logo(), this.ensureSequences(today)])
    return transaction(this.pool, db => this.finalizeIn(db, id, engine, settings, logo, today, now, null))
  }

  private async finalizeIn(db: PoolConnection, id: number, engine: InvoiceEngine, settings: CompanySettings | null,
    logo: { data: Buffer, type: string } | null, today: string, now: string,
    cancellation: { precedingNumber: string, buyer: PartyDocument, smallBusiness: boolean, exemptionReason: string | null, correction: boolean } | null): Promise<string> {
    const draft = await one<{ status: string, type: '380' | '381', customerId: number, deliveryDate: string, paymentDays: number, note: string | null }>(db,
      'SELECT status, type, customer_id AS customerId, delivery_date AS deliveryDate, payment_days AS paymentDays, note FROM invoices WHERE id = ? FOR UPDATE', [id])
    if (draft === null) throw new InvoiceError('Die Rechnung existiert nicht.')
    if (draft.status !== 'draft') throw new InvoiceError('Die Rechnung ist bereits festgeschrieben.')
    const lines = await this.lines(id, db)
    const smallBusiness = cancellation?.smallBusiness ?? settings?.smallBusiness ?? true
    const exemptionReason = cancellation !== null ? cancellation.exemptionReason : settings?.exemptionReason ?? null
    const problem = finalizeProblem(lines, settings, smallBusiness, exemptionReason)
    if (problem !== null) throw new InvoiceError(problem)
    let buyer = cancellation?.buyer ?? null
    if (buyer === null) {
      const customer = await new MasterData(db).customer(draft.customerId)
      if (customer === null) throw new InvoiceError('Der Kunde existiert nicht mehr.')
      buyer = MasterData.buyer(customer)
    }
    const seller = MasterData.seller(settings!)

    // Row locks serialize finalizing: one chain row for the hash chain, one row per year
    // for the numbers. A second request waits here until the first one has committed.
    const year = Number(today.slice(0, 4))
    const chain = await one<{ next: number }>(db, `SELECT next_value AS next FROM number_sequences WHERE kind = 'chain' AND year = 0 FOR UPDATE`)
    const sequence = await one<{ next: number }>(db, `SELECT next_value AS next FROM number_sequences WHERE kind = 'invoice' AND year = ? FOR UPDATE`, [year])
    const number = documentNumber('invoice', year, sequence!.next)
    const chainNo = chain!.next
    const prev = chainNo === 1 ? null : await one<{ hash: string }>(db, 'SELECT hash FROM invoices WHERE chain_no = ?', [chainNo - 1])
    if (chainNo > 1 && prev === null) throw new Error(`Hash chain broken: invoice with chain_no ${chainNo - 1} is missing.`)

    const dueDate = addDays(today, draft.paymentDays)
    const t = totals(lines)
    const document = this.document('invoice', number, today, draft.deliveryDate, dueDate, seller, buyer, lines,
      { smallBusiness, exemptionReason }, draft.note, logo, draft.type, cancellation?.precedingNumber ?? null, cancellation?.correction ?? false)
    const { pdf, xml } = await render(engine, document)
    if (xml === null) throw new Error('The engine returned no XML for an invoice.')
    const pdfSha = sha256(pdf)
    const xmlSha = sha256(xml)
    const hash = chainHash(prev?.hash ?? null, number, xmlSha, pdfSha)

    await exec(db, 'INSERT INTO invoice_documents (invoice_id, kind, content, sha256, created_at) VALUES (?, \'pdf\', ?, ?, ?), (?, \'xml\', ?, ?, ?)',
      [id, pdf, pdfSha, now, id, Buffer.from(xml, 'utf8'), xmlSha, now])
    await exec(db, `UPDATE invoices SET status = 'final', number = ?, issue_date = ?, due_date = ?, seller = ?, buyer = ?, small_business = ?,
      exemption_reason = ?, net_cents = ?, tax_cents = ?, gross_cents = ?, finalized_at = ?, chain_no = ?, prev_hash = ?, hash = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
    [number, today, dueDate, JSON.stringify(seller), JSON.stringify(buyer), smallBusiness ? 1 : 0, smallBusiness ? null : exemptionReason,
      t.net, t.tax, t.gross, now, chainNo, prev?.hash ?? null, hash, now, id])
    await exec(db, `UPDATE number_sequences SET next_value = next_value + 1 WHERE (kind = 'chain' AND year = 0) OR (kind = 'invoice' AND year = ?)`, [year])
    await this.event(db, id, 'finalized', number, now)
    return number
  }

  /** Cancels a finalized invoice with a Stornorechnung over all its lines; returns the new id and number. */
  async cancel(id: number, reason: string | null, engine: InvoiceEngine, master: MasterData, today: string, now: string): Promise<{ id: number, number: string }> {
    const note = reason !== null && reason !== '' ? `Grund der Stornierung: ${reason}` : null
    return this.credit(id, null, note, engine, master, today, now, (number) => `durch ${number}${reason ? `: ${reason}` : ''}`)
  }

  /**
   * Credits part of a finalized invoice with a Rechnungskorrektur: the given positions
   * (taken from the invoice, with smaller quantities or prices) as a document of type 381.
   * Several corrections are possible, together at most the invoice's gross amount.
   */
  async correct(id: number, lines: Line[], reason: string | null, engine: InvoiceEngine, master: MasterData, today: string, now: string): Promise<{ id: number, number: string }> {
    const note = reason !== null && reason !== '' ? `Grund der Korrektur: ${reason}` : null
    return this.credit(id, lines, note, engine, master, today, now, (number) => `${number}${reason ? `: ${reason}` : ''}`)
  }

  /** A 381 to an invoice: all its lines (cancellation, lines null) or the given ones (correction). */
  private async credit(id: number, partialLines: Line[] | null, note: string | null, engine: InvoiceEngine, master: MasterData, today: string, now: string,
    detail: (number: string) => string): Promise<{ id: number, number: string }> {
    const [settings, logo] = await Promise.all([master.settings(), master.logo(), this.ensureSequences(today)])
    return transaction(this.pool, async (db) => {
      // FOR UPDATE on the invoice serializes cancellations and corrections of it, so two
      // clicks cannot cancel it twice or credit more than its amount.
      const original = await one<{ status: string, type: string, number: string, customerId: number, projectId: number | null, deliveryDate: string,
        buyer: string, smallBusiness: number, exemptionReason: string | null, grossCents: number }>(db,
      `SELECT status, type, number, customer_id AS customerId, project_id AS projectId, delivery_date AS deliveryDate, buyer,
        small_business AS smallBusiness, exemption_reason AS exemptionReason, gross_cents AS grossCents FROM invoices WHERE id = ? FOR UPDATE`, [id])
      if (original === null) throw new InvoiceError('Die Rechnung existiert nicht.')
      const what = partialLines === null ? 'storniert' : 'korrigiert'
      if (original.status !== 'final' || original.type !== '380') throw new InvoiceError(`Nur festgeschriebene Rechnungen können ${what} werden.`)
      const earlier = await rows<{ partial: number, grossCents: number }>(db,
        `SELECT partial, gross_cents AS grossCents FROM invoices WHERE preceding_invoice_id = ? AND type = '381'`, [id])
      if (earlier.some(e => Number(e.partial) === 0)) throw new InvoiceError('Die Rechnung ist bereits storniert.')
      const credited = earlier.reduce((sum, e) => sum + num(e.grossCents), 0)
      const smallBusiness = original.smallBusiness === 1
      let lines: Line[]
      if (partialLines === null) {
        if (credited > 0) throw new InvoiceError('Zu dieser Rechnung gibt es schon eine Rechnungskorrektur. Schreibe den Rest bitte mit einer weiteren Rechnungskorrektur gut.')
        lines = await this.lines(id, db)
      }
      else {
        lines = partialLines
        const problem = correctionProblem(await this.lines(id, db), lines, num(original.grossCents) - credited, smallBusiness)
        if (problem !== null) throw new InvoiceError(problem)
      }
      const newId = await this.createDraft({ customerId: original.customerId, projectId: original.projectId, deliveryDate: original.deliveryDate, paymentDays: 0, note, lines }, now, db)
      await exec(db, `UPDATE invoices SET type = '381', preceding_invoice_id = ?, partial = ? WHERE id = ?`, [id, partialLines === null ? 0 : 1, newId])
      const number = await this.finalizeIn(db, newId, engine, settings, logo, today, now, {
        precedingNumber: original.number, buyer: JSON.parse(original.buyer) as PartyDocument,
        smallBusiness, exemptionReason: original.exemptionReason, correction: partialLines !== null,
      })
      await this.event(db, id, partialLines === null ? 'cancelled' : 'corrected', detail(number), now)
      return { id: newId, number }
    })
  }

  async file(id: number, kind: 'pdf' | 'xml'): Promise<{ content: Buffer, number: string } | null> {
    return one<{ content: Buffer, number: string }>(this.pool,
      'SELECT d.content, i.number FROM invoice_documents d JOIN invoices i ON i.id = d.invoice_id WHERE d.invoice_id = ? AND d.kind = ?', [id, kind])
  }

  async addPayment(id: number, p: { paidOn: string, amountCents: number, note: string | null }, now: string): Promise<void> {
    await exec(this.pool, 'INSERT INTO invoice_payments (invoice_id, paid_on, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?)', [id, p.paidOn, p.amountCents, p.note, now])
    await this.event(this.pool, id, 'payment', `${p.paidOn}: ${p.amountCents} ct${p.note ? ` (${p.note})` : ''}`, now)
  }

  async deletePayment(id: number, paymentId: number, now: string): Promise<boolean> {
    const payment = await one<{ paidOn: string, amountCents: number }>(this.pool, 'SELECT paid_on AS paidOn, amount_cents AS amountCents FROM invoice_payments WHERE id = ? AND invoice_id = ?', [paymentId, id])
    if (payment === null) return false
    await exec(this.pool, 'DELETE FROM invoice_payments WHERE id = ?', [paymentId])
    await this.event(this.pool, id, 'payment-deleted', `${payment.paidOn}: ${payment.amountCents} ct`, now)
    return true
  }

  async addReminder(id: number, r: { level: number, sentOn: string, newDueDate: string, recipient: string, body: string }, now: string): Promise<void> {
    await exec(this.pool, 'INSERT INTO invoice_reminders (invoice_id, level, sent_on, new_due_date, recipient, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, r.level, r.sentOn, r.newDueDate, r.recipient, r.body, now])
  }

  /**
   * Recomputes every stored file's SHA-256 and the hash chain. Any change made around
   * the application (directly in the database) shows up here.
   */
  async verify(): Promise<{ count: number, problems: string[] }> {
    const list = await rows<{ id: number, number: string, chainNo: number, prevHash: string | null, hash: string }>(this.pool,
      `SELECT id, number, chain_no AS chainNo, prev_hash AS prevHash, hash FROM invoices WHERE status = 'final' ORDER BY chain_no`)
    const problems: string[] = []
    let prev: string | null = null
    for (const [i, inv] of list.entries()) {
      if (inv.chainNo !== i + 1) problems.push(`${inv.number}: Lücke in der Kette vor Glied ${inv.chainNo}.`)
      if (inv.prevHash !== prev) problems.push(`${inv.number}: Verweis auf die vorige Rechnung stimmt nicht.`)
      const docs = await rows<{ kind: string, content: Buffer, sha256: string }>(this.pool, 'SELECT kind, content, sha256 FROM invoice_documents WHERE invoice_id = ?', [inv.id])
      const pdf = docs.find(d => d.kind === 'pdf')
      const xml = docs.find(d => d.kind === 'xml')
      if (pdf === undefined || xml === undefined) {
        problems.push(`${inv.number}: Datei fehlt.`)
      }
      else {
        if (sha256(pdf.content) !== pdf.sha256) problems.push(`${inv.number}: PDF wurde verändert.`)
        if (sha256(xml.content) !== xml.sha256) problems.push(`${inv.number}: XML wurde verändert.`)
        if (chainHash(inv.prevHash, inv.number, xml.sha256, pdf.sha256) !== inv.hash) problems.push(`${inv.number}: Prüfsumme stimmt nicht.`)
      }
      prev = inv.hash
    }
    return { count: list.length, problems }
  }
}

/** Renders and turns refusals of the PHP side into a message for the user. */
export async function render(engine: InvoiceEngine, document: RenderDocument): Promise<{ pdf: Buffer, xml: string | null }> {
  try {
    return await engine.render(document)
  }
  catch (e) {
    if (e instanceof EngineInputError) throw new InvoiceError(`Das Dokument konnte nicht erzeugt werden: ${e.message}`)
    throw e
  }
}

