import type { Pool } from 'mysql2/promise'
import { day, type Line } from '#shared/lib/erp'
import type { TimeEntry } from '#shared/types/erp'
import type { TimeInput } from './forms'
import { InvoiceError, type InvoiceRepository } from './invoices'
import { exec, one, rows, transaction } from './sql'

// Time and services to bill later (module 6): hours worked or flat services per
// customer, optionally for a project or an order. Billing turns the selected entries
// into the positions of one draft invoice; until that draft is finalized it can be
// deleted, which frees the entries again.

const COLUMNS = `t.id, t.work_date AS workDate, t.customer_id AS customerId, c.name AS customerName, t.project_id AS projectId,
  t.order_id AS orderId, o.number AS orderNumber, t.description, t.quantity_milli AS quantityMilli, t.unit,
  t.unit_price_cents AS unitPriceCents, t.vat_rate AS vatRate, t.invoice_id AS invoiceId, i.number AS invoiceNumber, i.status AS invoiceStatus`
const FROM = `FROM time_entries t JOIN customers c ON c.id = t.customer_id
  LEFT JOIN sales_documents o ON o.id = t.order_id LEFT JOIN invoices i ON i.id = t.invoice_id`

/** One position per entry: the first line of the text as name, the date and the rest as description. */
export function entryLine(e: Pick<TimeEntry, 'workDate' | 'description' | 'quantityMilli' | 'unit' | 'unitPriceCents' | 'vatRate'>): Line {
  const [first = '', ...rest] = e.description.split('\n')
  const name = [...first].length > 150 ? `${[...first].slice(0, 149).join('')}…` : first
  const description = [`Leistung am ${day(e.workDate)}`, ...rest].join('\n')
  return { name, description: [...description].slice(0, 500).join(''), quantityMilli: e.quantityMilli, unit: e.unit, unitPriceCents: e.unitPriceCents, vatRate: e.vatRate }
}

export class TimeRepository {
  constructor(private readonly pool: Pool) {}

  /** Unbilled entries first, then the billed ones of the last year. */
  async list(since: string): Promise<TimeEntry[]> {
    return rows<TimeEntry>(this.pool, `SELECT ${COLUMNS} ${FROM} WHERE t.invoice_id IS NULL OR t.work_date >= ?
      ORDER BY t.invoice_id IS NULL DESC, t.work_date DESC, t.id DESC`, [since])
  }

  async find(id: number): Promise<TimeEntry | null> {
    return one<TimeEntry>(this.pool, `SELECT ${COLUMNS} ${FROM} WHERE t.id = ?`, [id])
  }

  async add(t: TimeInput, now: string): Promise<number> {
    return (await exec(this.pool, `INSERT INTO time_entries (work_date, customer_id, project_id, order_id, description, quantity_milli, unit,
      unit_price_cents, vat_rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.workDate, t.customerId, t.projectId, t.orderId, t.description, t.quantityMilli, t.unit, t.unitPriceCents, t.vatRate, now, now])).insertId
  }

  /** false if the entry is billed already (then the invoice draft is the place to change it). */
  async update(id: number, t: TimeInput, now: string): Promise<boolean> {
    return (await exec(this.pool, `UPDATE time_entries SET work_date = ?, customer_id = ?, project_id = ?, order_id = ?, description = ?, quantity_milli = ?,
      unit = ?, unit_price_cents = ?, vat_rate = ?, updated_at = ? WHERE id = ? AND invoice_id IS NULL`,
    [t.workDate, t.customerId, t.projectId, t.orderId, t.description, t.quantityMilli, t.unit, t.unitPriceCents, t.vatRate, now, id])).affectedRows > 0
  }

  async delete(id: number): Promise<boolean> {
    return (await exec(this.pool, 'DELETE FROM time_entries WHERE id = ? AND invoice_id IS NULL', [id])).affectedRows > 0
  }

  /** One draft invoice for the selected unbilled entries of one customer; returns its id. */
  async bill(ids: number[], invoices: InvoiceRepository, paymentDays: number, now: string): Promise<number> {
    if (ids.length === 0) throw new InvoiceError('Bitte wähle mindestens einen Eintrag.')
    if (ids.length > 100) throw new InvoiceError('Höchstens 100 Einträge auf einmal (eine Rechnung hat höchstens 100 Positionen).')
    return transaction(this.pool, async (db) => {
      const entries = await rows<TimeEntry>(db, `SELECT ${COLUMNS} ${FROM} WHERE t.id IN (?) ORDER BY t.work_date, t.id FOR UPDATE`, [ids])
      if (entries.length !== new Set(ids).size) throw new InvoiceError('Einige Einträge existieren nicht mehr.')
      if (entries.some(e => e.invoiceId !== null)) throw new InvoiceError('Einige Einträge sind bereits abgerechnet.')
      const customers = new Set(entries.map(e => e.customerId))
      if (customers.size > 1) throw new InvoiceError('Bitte nur Einträge eines Kunden zusammen abrechnen.')
      const projects = new Set(entries.map(e => e.projectId))
      const first = entries[0]!.workDate
      const last = entries.at(-1)!.workDate
      const orders = [...new Set(entries.map(e => e.orderNumber).filter(n => n !== null))]
      const note = [
        first === last ? null : `Leistungszeitraum ${day(first)} – ${day(last)}`,
        orders.length > 0 ? `Zu ${orders.length === 1 ? 'Auftrag' : 'Aufträgen'} ${orders.join(', ')}` : null,
      ].filter(v => v !== null).join('\n') || null
      const invoiceId = await invoices.createDraft({
        customerId: entries[0]!.customerId, projectId: projects.size === 1 ? entries[0]!.projectId : null, deliveryDate: last,
        paymentDays, note, lines: entries.map(entryLine), source: { type: 'time', id: entries[0]!.id },
      }, now, db)
      await exec(db, 'UPDATE time_entries SET invoice_id = ?, updated_at = ? WHERE id IN (?)', [invoiceId, now, ids])
      return invoiceId
    })
  }

  /** Issued orders, to file entries under them. */
  async orders(): Promise<{ id: number, name: string, customerId: number }[]> {
    return rows(this.pool, `SELECT id, number AS name, customer_id AS customerId FROM sales_documents WHERE kind = 'order' AND status <> 'draft' ORDER BY issue_date DESC, id DESC`)
  }
}
