import { createHash } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import type { IncomingInvoice, ProjectShare, Supplier } from '#shared/types/erp'
import { EngineInputError, type IncomingFields, type InvoiceEngine } from './engine'
import { incomingType } from './files'
import type { IncomingInput, SupplierInput } from './forms'
import { InvoiceError } from './invoices'
import { exec, num, one, rows, type Sql, transaction } from './sql'

// Incoming invoices (module 3). The received file is stored once and never changed. For
// an e-invoice (ZUGFeRD PDF or CII XML) the fields are read from its XML, which is what
// counts legally; for anything else (a plain PDF, a photo) they are typed in by hand.
// Two checks protect against paying twice or paying a fraudster: the same file or the
// same supplier invoice number cannot be entered twice, and an IBAN that differs from
// the supplier's earlier invoices is flagged.

const COLUMNS = `i.id, i.supplier_id AS supplierId, s.name AS supplierName, i.status, i.number, i.issue_date AS issueDate, i.due_date AS dueDate,
  i.net_cents AS netCents, i.tax_cents AS taxCents, i.gross_cents AS grossCents, i.category, i.project_id AS projectId, i.iban, i.note,
  i.format, i.file_name AS fileName, i.file_type AS fileType, i.paid_on AS paidOn, i.discarded_reason AS discardedReason, i.created_at AS createdAt`

const SUPPLIER_COLUMNS = 'id, name, vat_id AS vatId, tax_number AS taxNumber, iban, email, street, postcode, city, country, note'

/** What was typed in for a file without e-invoice data. */
export interface ManualEntry { supplierId: number | null, supplierName: string | null, fields: IncomingInput }

const amounts = (i: IncomingInvoice): IncomingInvoice => ({ ...i, netCents: num(i.netCents), taxCents: num(i.taxCents), grossCents: num(i.grossCents) })

/** The project with the largest share (the first on a tie), kept in incoming_invoices.project_id. */
const mainProject = (projects: ProjectShare[]) => [...projects].sort((a, b) => b.shareBp - a.shareBp)[0]?.projectId ?? null

/** Replaces the project shares of an invoice. */
async function writeShares(db: Sql, id: number, projects: ProjectShare[]): Promise<void> {
  await exec(db, 'DELETE FROM incoming_invoice_projects WHERE incoming_invoice_id = ?', [id])
  for (const p of projects) {
    await exec(db, 'INSERT INTO incoming_invoice_projects (incoming_invoice_id, project_id, share_bp) VALUES (?, ?, ?)', [id, p.projectId, p.shareBp])
  }
}

export class IncomingRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<IncomingInvoice[]> {
    const list = await rows<IncomingInvoice>(this.pool, `SELECT ${COLUMNS} FROM incoming_invoices i JOIN suppliers s ON s.id = i.supplier_id
      ORDER BY i.status = 'open' DESC, i.issue_date DESC, i.id DESC`)
    return this.withShares(list, 'SELECT incoming_invoice_id AS id, project_id AS projectId, share_bp AS shareBp FROM incoming_invoice_projects', [])
  }

  async find(id: number): Promise<IncomingInvoice | null> {
    const row = await one<IncomingInvoice>(this.pool, `SELECT ${COLUMNS} FROM incoming_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?`, [id])
    if (row === null) return null
    return (await this.withShares([row], `SELECT incoming_invoice_id AS id, project_id AS projectId, share_bp AS shareBp FROM incoming_invoice_projects
      WHERE incoming_invoice_id = ?`, [id]))[0]!
  }

  /** Adds the project shares (largest first) to the invoices. */
  private async withShares(list: IncomingInvoice[], sql: string, params: unknown[]): Promise<IncomingInvoice[]> {
    const byInvoice = new Map<number, ProjectShare[]>()
    for (const r of await rows<{ id: number, projectId: unknown, shareBp: unknown }>(this.pool, sql, params)) {
      byInvoice.set(r.id, [...(byInvoice.get(r.id) ?? []), { projectId: num(r.projectId), shareBp: num(r.shareBp) }])
    }
    return list.map(i => ({ ...amounts(i), projectId: i.projectId === null ? null : num(i.projectId),
      projects: (byInvoice.get(i.id) ?? []).sort((a, b) => b.shareBp - a.shareBp || a.projectId - b.projectId) }))
  }

  /** The IBANs the supplier's other invoices asked for, to spot a changed account. */
  async otherIbans(invoice: IncomingInvoice): Promise<string[]> {
    const list = await rows<{ iban: string }>(this.pool, `SELECT DISTINCT iban FROM incoming_invoices
      WHERE supplier_id = ? AND id <> ? AND iban IS NOT NULL AND status <> 'discarded'`, [invoice.supplierId, invoice.id])
    const supplier = await this.supplier(invoice.supplierId)
    return [...new Set([...list.map(r => r.iban), ...(supplier?.iban ? [supplier.iban] : [])])]
  }

  async file(id: number): Promise<{ content: Buffer, name: string, type: string } | null> {
    return one(this.pool, `SELECT f.content, i.file_name AS name, i.file_type AS type FROM incoming_invoice_files f
      JOIN incoming_invoices i ON i.id = f.incoming_invoice_id WHERE f.incoming_invoice_id = ?`, [id])
  }

  async suppliers(): Promise<Supplier[]> {
    return rows<Supplier>(this.pool, `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE archived_at IS NULL ORDER BY name, id`)
  }

  async supplier(id: number): Promise<Supplier | null> {
    return one<Supplier>(this.pool, `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id = ?`, [id])
  }

  async updateSupplier(id: number, s: SupplierInput): Promise<void> {
    await exec(this.pool, `UPDATE suppliers SET name = ?, vat_id = ?, tax_number = ?, iban = ?, email = ?, street = ?, postcode = ?, city = ?, country = ?, note = ? WHERE id = ?`,
      [s.name, s.vatId, s.taxNumber, s.iban, s.email, s.street, s.postcode, s.city, s.country, s.note, id])
  }

  /**
   * Stores an uploaded invoice. An e-invoice fills itself; otherwise `manual` must be
   * given. Returns the new id and warnings for the user.
   */
  async upload(file: { name: string, data: Buffer }, manual: ManualEntry | string | null, category: string, projects: ProjectShare[],
    engine: InvoiceEngine, now: string): Promise<{ id: number, warnings: string[], format: string }> {
    const type = incomingType(file.data)
    if (type === null) throw new InvoiceError('Erlaubt sind E-Rechnungen (XML), PDF-Dateien und Fotos (PNG, JPEG).')
    const sha = createHash('sha256').update(file.data).digest('hex')
    const same = await one<{ id: number }>(this.pool, 'SELECT id FROM incoming_invoices WHERE file_sha256 = ?', [sha])
    if (same !== null) throw new InvoiceError(`Diese Datei wurde bereits erfasst (Eingangsrechnung Nr. ${same.id}).`)

    let fields: IncomingFields | null = null
    if (type === 'application/pdf' || type === 'application/xml') {
      try {
        fields = await engine.read(file.data)
      }
      catch (e) {
        if (!(e instanceof EngineInputError)) throw e
        if (type === 'application/xml') throw new InvoiceError('Die XML-Datei ist keine lesbare E-Rechnung im CII-Format (UBL wird nicht unterstützt).')
      }
    }
    const warnings: string[] = []
    let values: IncomingInput
    let supplierId: number
    if (fields !== null) {
      if (fields.currency !== 'EUR') throw new InvoiceError(`Die Rechnung ist in ${fields.currency}; das Cockpit rechnet nur in Euro.`)
      if (fields.typeCode === '381') warnings.push('Das ist eine Gutschrift oder Stornorechnung. Die Beträge sind positiv erfasst; bitte prüfe die Zuordnung.')
      if (fields.issueDate === null || fields.number === '') throw new InvoiceError('Der E-Rechnung fehlen Nummer oder Datum.')
      supplierId = await this.supplierFor(fields.supplier, fields.iban, now)
      values = {
        number: fields.number.slice(0, 60), issueDate: fields.issueDate, dueDate: fields.dueDate, netCents: fields.netCents,
        taxCents: fields.taxCents, grossCents: fields.grossCents, category, projects, iban: fields.iban, note: null,
      }
      if (fields.dueCents !== fields.grossCents) warnings.push(`Zu zahlen sind laut Rechnung ${(fields.dueCents / 100).toFixed(2).replace('.', ',')} € (Anzahlungen oder Rundung).`)
    }
    else {
      if (manual === null) throw new InvoiceError('Die Datei enthält keine E-Rechnung. Bitte trage Lieferant, Nummer, Datum und Beträge ein.')
      if (typeof manual === 'string') throw new InvoiceError(manual)
      if (manual.supplierId !== null) {
        if (await this.supplier(manual.supplierId) === null) throw new InvoiceError('Unbekannter Lieferant.')
        supplierId = manual.supplierId
      }
      else if (manual.supplierName !== null) {
        supplierId = await this.supplierFor({ name: manual.supplierName, vatId: null, taxNumber: null, street: null, postcode: null, city: null, country: null, email: null }, manual.fields.iban, now)
      }
      else {
        throw new InvoiceError('Bitte einen Lieferanten wählen oder den Namen eines neuen eintragen.')
      }
      values = { ...manual.fields, category, projects }
    }

    const twin = await one<{ id: number }>(this.pool, `SELECT id FROM incoming_invoices WHERE supplier_id = ? AND number = ? AND status <> 'discarded'`, [supplierId, values.number])
    if (twin !== null) throw new InvoiceError(`Die Rechnung ${values.number} dieses Lieferanten ist bereits erfasst (Eingangsrechnung Nr. ${twin.id}).`)

    const format = fields === null ? 'other' : fields.format
    const id = await transaction(this.pool, async (db) => {
      const result = await exec(db, `INSERT INTO incoming_invoices (supplier_id, status, number, issue_date, due_date, net_cents, tax_cents, gross_cents,
        category, project_id, iban, note, format, file_name, file_type, file_sha256, created_at, updated_at)
        VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [supplierId, values.number, values.issueDate, values.dueDate, values.netCents, values.taxCents, values.grossCents, values.category,
        mainProject(values.projects), values.iban, values.note, format, file.name.slice(0, 190), type, sha, now, now])
      await exec(db, 'INSERT INTO incoming_invoice_files (incoming_invoice_id, content, created_at) VALUES (?, ?, ?)', [result.insertId, file.data, now])
      await writeShares(db, result.insertId, values.projects)
      return result.insertId
    })
    const created = await this.find(id)
    const known = await this.otherIbans(created!)
    if (values.iban !== null && known.length > 0 && !known.includes(values.iban)) {
      warnings.push(`Achtung: Die IBAN ${values.iban} weicht von früheren Rechnungen dieses Lieferanten ab. Bitte vor dem Bezahlen telefonisch bestätigen lassen (Betrugsmasche „geänderte Bankverbindung“).`)
    }
    return { id, warnings, format }
  }

  /** The supplier with this VAT id (or exactly this name); a new one otherwise. */
  private async supplierFor(s: IncomingFields['supplier'], iban: string | null, now: string): Promise<number> {
    const found = s.vatId !== null
      ? await one<{ id: number }>(this.pool, 'SELECT id FROM suppliers WHERE vat_id = ? ORDER BY id LIMIT 1', [s.vatId])
      : null
    const byName = found ?? await one<{ id: number }>(this.pool, 'SELECT id FROM suppliers WHERE name = ? ORDER BY id LIMIT 1', [s.name])
    if (byName !== null) return byName.id
    const name = s.name.trim() === '' ? 'Unbekannter Lieferant' : s.name.slice(0, 100)
    const result = await exec(this.pool, `INSERT INTO suppliers (name, vat_id, tax_number, iban, email, street, postcode, city, country, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name, s.vatId?.slice(0, 20) ?? null, s.taxNumber?.slice(0, 30) ?? null, iban, s.email?.slice(0, 190) ?? null,
      s.street?.slice(0, 100) ?? null, s.postcode?.slice(0, 10) ?? null, s.city?.slice(0, 100) ?? null, s.country?.slice(0, 2) ?? null, now])
    return result.insertId
  }

  async update(id: number, v: IncomingInput, now: string): Promise<boolean> {
    return transaction(this.pool, async (db) => {
      const result = await exec(db, `UPDATE incoming_invoices SET number = ?, issue_date = ?, due_date = ?, net_cents = ?, tax_cents = ?, gross_cents = ?,
        category = ?, project_id = ?, iban = ?, note = ?, updated_at = ? WHERE id = ? AND status <> 'discarded'`,
      [v.number, v.issueDate, v.dueDate, v.netCents, v.taxCents, v.grossCents, v.category, mainProject(v.projects), v.iban, v.note, now, id])
      if (result.affectedRows === 0) return false
      await writeShares(db, id, v.projects)
      return true
    })
  }

  async setPaid(id: number, paidOn: string | null, now: string): Promise<boolean> {
    const result = await exec(this.pool, `UPDATE incoming_invoices SET status = ?, paid_on = ?, updated_at = ? WHERE id = ? AND status <> 'discarded'`,
      [paidOn === null ? 'open' : 'paid', paidOn, now, id])
    return result.affectedRows > 0
  }

  /** A wrong entry (e.g. no invoice at all) is set aside with a reason; the file stays. */
  async discard(id: number, reason: string, now: string): Promise<boolean> {
    const result = await exec(this.pool, `UPDATE incoming_invoices SET status = 'discarded', discarded_reason = ?, updated_at = ? WHERE id = ? AND status <> 'discarded'`, [reason, now, id])
    return result.affectedRows > 0
  }
}
