import type { CatalogItem, Choice, CompanySettings, Customer } from '#shared/types/erp'
import type { PartyDocument } from './engine'
import type { CatalogInput, CustomerInput, SettingsInput } from './forms'
import { exec, one, rows, type Sql } from './sql'

// Own company data (one row), customers and the catalog of products and services.

const SETTINGS_COLUMNS = `name, contact_name AS contactName, street, postcode, city, country, email, phone, website,
  tax_number AS taxNumber, vat_id AS vatId, iban, bic, bank_name AS bankName, small_business AS smallBusiness,
  payment_days AS paymentDays, exemption_reason AS exemptionReason, mail_from AS mailFrom, mail_text AS mailText,
  logo IS NOT NULL AS hasLogo`

const CUSTOMER_COLUMNS = `id, kind, name, contact_name AS contactName, street, postcode, city, country, email,
  vat_id AS vatId, project_id AS projectId, note, archived_at IS NOT NULL AS archived`

const CATALOG_COLUMNS = `id, name, description, unit, unit_price_cents AS unitPriceCents, vat_rate AS vatRate, archived_at IS NOT NULL AS archived`

/** TINYINT and IS NOT NULL come back as 0/1; the API answers true/false. */
function bool<T extends object>(row: T, ...keys: (keyof T)[]): T {
  for (const key of keys) (row as Record<keyof T, unknown>)[key] = Boolean(row[key])
  return row
}

export class MasterData {
  constructor(private readonly db: Sql) {}

  async settings(): Promise<CompanySettings | null> {
    const row = await one<CompanySettings>(this.db, `SELECT ${SETTINGS_COLUMNS} FROM company_settings WHERE id = 1`)
    return row === null ? null : bool(row, 'smallBusiness', 'hasLogo')
  }

  async saveSettings(s: SettingsInput, now: string): Promise<void> {
    const values = [s.name, s.contactName, s.street, s.postcode, s.city, s.country, s.email, s.phone, s.website, s.taxNumber, s.vatId,
      s.iban, s.bic, s.bankName, s.smallBusiness ? 1 : 0, s.paymentDays, s.exemptionReason, s.mailFrom, s.mailText, now]
    await exec(this.db, `INSERT INTO company_settings (id, name, contact_name, street, postcode, city, country, email, phone, website,
      tax_number, vat_id, iban, bic, bank_name, small_business, payment_days, exemption_reason, mail_from, mail_text, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), contact_name = VALUES(contact_name), street = VALUES(street),
      postcode = VALUES(postcode), city = VALUES(city), country = VALUES(country), email = VALUES(email), phone = VALUES(phone),
      website = VALUES(website), tax_number = VALUES(tax_number), vat_id = VALUES(vat_id), iban = VALUES(iban), bic = VALUES(bic),
      bank_name = VALUES(bank_name), small_business = VALUES(small_business), payment_days = VALUES(payment_days),
      exemption_reason = VALUES(exemption_reason), mail_from = VALUES(mail_from), mail_text = VALUES(mail_text), updated_at = VALUES(updated_at)`, values)
  }

  async logo(): Promise<{ data: Buffer, type: string } | null> {
    const row = await one<{ logo: Buffer | null, type: string | null }>(this.db, 'SELECT logo, logo_type AS type FROM company_settings WHERE id = 1')
    return row?.logo && row.type ? { data: row.logo, type: row.type } : null
  }

  /** false if the company data is not saved yet (the logo needs the row). */
  async setLogo(logo: { data: Buffer, type: string } | null, now: string): Promise<boolean> {
    const result = await exec(this.db, 'UPDATE company_settings SET logo = ?, logo_type = ?, updated_at = ? WHERE id = 1', [logo?.data ?? null, logo?.type ?? null, now])
    return result.affectedRows > 0
  }

  /** The seller as printed: company data with bank details (frozen into each invoice). */
  static seller(s: CompanySettings): PartyDocument & { iban: string, bic: string | null, bankName: string | null } {
    return {
      name: s.name, street: s.street, postcode: s.postcode, city: s.city, country: s.country, taxNumber: s.taxNumber, vatId: s.vatId,
      email: s.email, phone: s.phone, contactName: s.contactName, iban: s.iban, bic: s.bic, bankName: s.bankName,
    }
  }

  static buyer(c: Customer): PartyDocument {
    return { name: c.name, street: c.street, postcode: c.postcode, city: c.city, country: c.country, vatId: c.vatId, email: c.email, contactName: c.contactName }
  }

  async customers(includeArchived = true): Promise<Customer[]> {
    const list = await rows<Customer>(this.db, `SELECT ${CUSTOMER_COLUMNS} FROM customers ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name, id`)
    return list.map(c => bool(c, 'archived'))
  }

  async customer(id: number): Promise<Customer | null> {
    const row = await one<Customer>(this.db, `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ?`, [id])
    return row === null ? null : bool(row, 'archived')
  }

  async customerIds(): Promise<number[]> {
    return (await rows<{ id: number }>(this.db, 'SELECT id FROM customers WHERE archived_at IS NULL')).map(r => r.id)
  }

  async addCustomer(c: CustomerInput, now: string): Promise<number> {
    const result = await exec(this.db, `INSERT INTO customers (kind, name, contact_name, street, postcode, city, country, email, vat_id, project_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [c.kind, c.name, c.contactName, c.street, c.postcode, c.city, c.country, c.email, c.vatId, c.projectId, c.note, now])
    return result.insertId
  }

  async updateCustomer(id: number, c: CustomerInput): Promise<void> {
    await exec(this.db, `UPDATE customers SET kind = ?, name = ?, contact_name = ?, street = ?, postcode = ?, city = ?, country = ?,
      email = ?, vat_id = ?, project_id = ?, note = ? WHERE id = ?`, [c.kind, c.name, c.contactName, c.street, c.postcode, c.city, c.country, c.email, c.vatId, c.projectId, c.note, id])
  }

  /** Customers are archived, not deleted: invoices keep referring to them. */
  async archiveCustomer(id: number, archived: boolean, now: string): Promise<boolean> {
    return (await exec(this.db, 'UPDATE customers SET archived_at = ? WHERE id = ?', [archived ? now : null, id])).affectedRows > 0
  }

  async catalog(includeArchived = true): Promise<CatalogItem[]> {
    const list = await rows<CatalogItem>(this.db, `SELECT ${CATALOG_COLUMNS} FROM catalog_items ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name, id`)
    return list.map(c => bool(c, 'archived'))
  }

  async catalogItem(id: number): Promise<CatalogItem | null> {
    const row = await one<CatalogItem>(this.db, `SELECT ${CATALOG_COLUMNS} FROM catalog_items WHERE id = ?`, [id])
    return row === null ? null : bool(row, 'archived')
  }

  async addCatalogItem(c: CatalogInput, now: string): Promise<number> {
    return (await exec(this.db, 'INSERT INTO catalog_items (name, description, unit, unit_price_cents, vat_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [c.name, c.description, c.unit, c.unitPriceCents, c.vatRate, now])).insertId
  }

  async updateCatalogItem(id: number, c: CatalogInput): Promise<void> {
    await exec(this.db, 'UPDATE catalog_items SET name = ?, description = ?, unit = ?, unit_price_cents = ?, vat_rate = ? WHERE id = ?',
      [c.name, c.description, c.unit, c.unitPriceCents, c.vatRate, id])
  }

  async archiveCatalogItem(id: number, archived: boolean, now: string): Promise<boolean> {
    return (await exec(this.db, 'UPDATE catalog_items SET archived_at = ? WHERE id = ?', [archived ? now : null, id])).affectedRows > 0
  }

  async projects(): Promise<Choice[]> {
    return rows<Choice>(this.db, 'SELECT id, name FROM projects ORDER BY name, id')
  }
}
