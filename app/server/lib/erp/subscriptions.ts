import type { Pool } from 'mysql2/promise'
import { addMonths, day, type Line, period } from '#shared/lib/erp'
import type { Subscription } from '#shared/types/erp'
import type { SubscriptionInput } from './forms'
import type { InvoiceRepository } from './invoices'
import { MasterData } from './masterData'
import { exec, LINE_COLUMNS, one, rows, type Sql, transaction } from './sql'

// Recurring invoices (module 4), e.g. a monthly maintenance contract. When next_date is
// reached, a draft invoice for the period starting then is created and next_date moves
// on by the interval. The draft is checked and finalized by hand, so nothing goes out
// unseen. The background jobs do this every 15 minutes; the page has a button too.

/** At most this many periods are caught up in one go (e.g. after a long pause). */
const MAX_CATCH_UP = 12

const COLUMNS = `s.id, s.customer_id AS customerId, c.name AS customerName, s.project_id AS projectId, s.name, s.interval_months AS intervalMonths,
  s.next_date AS nextDate, s.end_date AS endDate, s.note, s.active`

export class SubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Subscription[]> {
    const list = await rows<Subscription>(this.pool, `SELECT ${COLUMNS} FROM subscriptions s JOIN customers c ON c.id = s.customer_id ORDER BY s.active DESC, s.next_date, s.id`)
    return Promise.all(list.map(async s => ({ ...s, active: Boolean(s.active), lines: await this.lines(s.id) })))
  }

  async find(id: number, db: Sql = this.pool): Promise<Subscription | null> {
    const s = await one<Subscription>(db, `SELECT ${COLUMNS} FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`, [id])
    return s === null ? null : { ...s, active: Boolean(s.active), lines: await this.lines(id, db) }
  }

  private lines(id: number, db: Sql = this.pool): Promise<Line[]> {
    return rows<Line>(db, `SELECT ${LINE_COLUMNS} FROM subscription_lines WHERE subscription_id = ? ORDER BY position, id`, [id])
  }

  async save(id: number | null, s: SubscriptionInput, lines: Line[], now: string): Promise<number> {
    return transaction(this.pool, async (db) => {
      let target = id
      const values = [s.customerId, s.projectId, s.name, s.intervalMonths, s.nextDate, s.endDate, s.note, s.active ? 1 : 0, now]
      if (target === null) {
        target = (await exec(db, `INSERT INTO subscriptions (customer_id, project_id, name, interval_months, next_date, end_date, note, active, updated_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, now])).insertId
      }
      else {
        await exec(db, `UPDATE subscriptions SET customer_id = ?, project_id = ?, name = ?, interval_months = ?, next_date = ?, end_date = ?, note = ?, active = ?, updated_at = ?
          WHERE id = ?`, [...values, target])
        await exec(db, 'DELETE FROM subscription_lines WHERE subscription_id = ?', [target])
      }
      for (const [i, l] of lines.entries()) {
        await exec(db, `INSERT INTO subscription_lines (subscription_id, position, name, description, quantity_milli, unit, unit_price_cents, vat_rate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [target, i + 1, l.name, l.description, l.quantityMilli, l.unit, l.unitPriceCents, l.vatRate])
      }
      return target
    })
  }

  async delete(id: number): Promise<boolean> {
    return (await exec(this.pool, 'DELETE FROM subscriptions WHERE id = ?', [id])).affectedRows > 0
  }

  /**
   * Creates the draft for the next period and moves next_date on. Returns the new
   * invoice id, or null if the subscription is not active or has ended.
   */
  async bill(id: number, invoices: InvoiceRepository, now: string): Promise<number | null> {
    const settings = await new MasterData(this.pool).settings()
    return transaction(this.pool, async (db) => {
      const locked = await one<{ id: number }>(db, 'SELECT id FROM subscriptions WHERE id = ? FOR UPDATE', [id])
      const s = locked === null ? null : await this.find(id, db)
      if (s === null || !s.active || (s.endDate !== null && s.nextDate > s.endDate)) return null
      const range = period(s.nextDate, s.intervalMonths)
      const note = [`Leistungszeitraum ${day(range.from)} – ${day(range.to)}`, s.note].filter(v => v !== null && v !== '').join('\n')
      const invoiceId = await invoices.createDraft({
        customerId: s.customerId, projectId: s.projectId, deliveryDate: range.to, paymentDays: settings?.paymentDays ?? 14,
        note, lines: s.lines, source: { type: 'subscription', id },
      }, now, db)
      const next = addMonths(s.nextDate, s.intervalMonths)
      const ended = s.endDate !== null && next > s.endDate
      await exec(db, 'UPDATE subscriptions SET next_date = ?, active = ?, updated_at = ? WHERE id = ?', [next, ended ? 0 : 1, now, id])
      return invoiceId
    })
  }

  /** Drafts for every subscription whose date has come; returns how many were created. */
  async runDue(invoices: InvoiceRepository, today: string, now: string): Promise<number> {
    let created = 0
    for (let round = 0; round < MAX_CATCH_UP; round++) {
      const due = await rows<{ id: number }>(this.pool, `SELECT id FROM subscriptions WHERE active = 1 AND next_date <= ?
        AND (end_date IS NULL OR next_date <= end_date)`, [today])
      if (due.length === 0) break
      for (const { id } of due) {
        if (await this.bill(id, invoices, now) !== null) created++
      }
    }
    return created
  }
}
