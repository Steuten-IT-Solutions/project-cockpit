import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { InvoiceDetail, InvoiceSummary } from '../../shared/types/erp'
import { type Client, loggedIn } from './client'
import { BASE, resetDatabase, sql, startServer, stopServer } from './setup'

// The ERP end to end: the built server, MariaDB and the PHP e-invoice engine (bin/invoice.php).

const dir = mkdtempSync(join(tmpdir(), 'cockpit-erp-'))
const mails = join(dir, 'mails')
const sendmail = join(dir, 'sendmail')

const SETTINGS = {
  name: 'Steuten IT Solutions', contactName: 'Christian Steuten', street: 'Musterweg 1', postcode: '48143', city: 'Münster', country: 'DE',
  email: 'info@example.org', vatId: 'DE463748776', iban: 'DE89 3704 0044 0532 0130 00', smallBusiness: true, paymentDays: 14,
  mailFrom: 'Steuten IT Solutions <rechnung@example.org>', mailText: 'Anbei {dokument} {nummer} über {betrag}.',
}
const LINE = { name: 'Beratung', description: 'Vor Ort', quantity: '1,5', unit: 'HUR', price: '90,00', vatRate: 0 }

describe('ERP', () => {
  let client: Client
  let customerId: number
  let invoiceId: number
  let invoiceNumber: string

  const send = async (method: string, path: string, body?: unknown) => {
    const response = await client.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = await response.json() as Record<string, unknown>
    return { status: response.status, json }
  }
  const upload = async (path: string, form: FormData) => {
    const response = await fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: { 'cookie': client.cookie, 'x-csrf-token': client.csrf } })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }

  beforeAll(async () => {
    // A sendmail that stores each message instead of delivering it.
    writeFileSync(sendmail, `#!/bin/sh\ncat >> "${mails}"\necho "----" >> "${mails}"\n`)
    chmodSync(sendmail, 0o755)
    await resetDatabase()
    await sql(`INSERT INTO projects (id, full_name, owner, name, html_url, is_private, is_archived, is_fork, default_branch, synced_at, hidden)
      VALUES (1, 'Org/app', 'Org', 'app', 'https://github.com/Org/app', 1, 0, 0, 'main', NOW(), 0)`)
    await startServer({ NUXT_MAIL_SENDMAIL: sendmail, NUXT_ERP_PHP_DIR: join(import.meta.dirname, '../../..') })
    client = await loggedIn()
  }, 60000)
  afterAll(stopServer)

  it('needs a login', async () => {
    expect((await fetch(`${BASE}/api/erp/invoices`)).status).toBe(401)
  })

  it('saves company data, customers and the catalog', async () => {
    expect((await send('PUT', '/api/erp/settings', { ...SETTINGS, iban: 'DE00' })).json.statusMessage).toBe('Die IBAN ist ungültig.')
    expect((await send('PUT', '/api/erp/settings', SETTINGS)).status).toBe(200)
    const created = await send('POST', '/api/erp/customers', { kind: 'business', name: 'Kunde GmbH', street: 'Weg 2', postcode: '10115', city: 'Berlin', email: 'kunde@example.org', projectId: '1' })
    expect(created.status).toBe(200)
    customerId = created.json.id as number
    expect((await send('POST', '/api/erp/catalog', { name: 'Stunde', unit: 'HUR', price: '90', vatRate: 19 })).json.statusMessage).toContain('Kleinunternehmer')
    expect((await send('POST', '/api/erp/catalog', { name: 'Stunde', unit: 'HUR', price: '90', vatRate: 0 })).status).toBe(200)

    const logo = new FormData()
    logo.append('logo', new Blob([readFileSync(join(import.meta.dirname, '../../../tests/fixtures/logo.png'))], { type: 'image/png' }), 'logo.png')
    expect((await upload('/api/erp/logo', logo)).status).toBe(200)
    const fake = new FormData()
    fake.append('logo', new Blob(['<svg/>'], { type: 'image/png' }), 'logo.png')
    expect((await upload('/api/erp/logo', fake)).status).toBe(422)
  })

  it('writes, previews and finalizes an invoice', async () => {
    const draft = await send('POST', '/api/erp/invoices', { customerId, projectId: '1', deliveryDate: '2026-11-20', paymentDays: 14, note: 'Danke', lines: [LINE] })
    expect(draft.status).toBe(200)
    invoiceId = draft.json.id as number
    const preview = await client.request(`/api/erp/invoices/${invoiceId}/preview`)
    expect(preview.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')

    const finalized = await send('POST', `/api/erp/invoices/${invoiceId}/finalize`)
    expect(finalized.status).toBe(200)
    invoiceNumber = finalized.json.number as string
    expect(invoiceNumber).toMatch(/^R-\d{4}-0001$/)
    expect((await send('POST', `/api/erp/invoices/${invoiceId}/finalize`)).json.statusMessage).toBe('Die Rechnung ist bereits festgeschrieben.')
    expect((await send('PUT', `/api/erp/invoices/${invoiceId}`, { customerId, deliveryDate: '2026-11-20', lines: [LINE] })).status).toBe(422)
    expect((await send('DELETE', `/api/erp/invoices/${invoiceId}`)).status).toBe(422)

    const { invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${invoiceId}`)
    expect(invoice).toMatchObject({ status: 'final', state: 'open', grossCents: 13500, number: invoiceNumber })
    const pdf = Buffer.from(await (await client.request(`/api/erp/invoices/${invoiceId}/pdf`)).arrayBuffer())
    const again = Buffer.from(await (await client.request(`/api/erp/invoices/${invoiceId}/pdf`)).arrayBuffer())
    expect(pdf.equals(again)).toBe(true)
    const xml = await (await client.request(`/api/erp/invoices/${invoiceId}/xml`)).text()
    expect(xml).toContain(invoiceNumber)
    expect(xml).toContain('urn:cen.eu:en16931:2017')

    // The database itself refuses changes to what was issued.
    await expect(sql('UPDATE invoices SET note = ? WHERE id = ?', ['x', invoiceId])).rejects.toThrow(/cannot be changed/)
    await expect(sql('DELETE FROM invoice_documents WHERE invoice_id = ?', [invoiceId])).rejects.toThrow(/cannot be deleted/)
  })

  it('sends the invoice and records payments', async () => {
    const sent = await send('POST', `/api/erp/invoices/${invoiceId}/send`, {})
    expect(sent.json.message).toContain('kunde@example.org')
    const mail = readFileSync(mails, 'utf8')
    expect(mail).toContain('To: kunde@example.org')
    expect(mail).toContain(`filename="${invoiceNumber}.pdf"`)
    expect(Buffer.from(mail.split('\r\n\r\n')[2]!.split('\r\n--')[0]!.replaceAll('\r\n', ''), 'base64').toString()).toContain(`Anbei Rechnung ${invoiceNumber} über 135,00`)

    expect((await send('POST', `/api/erp/invoices/${invoiceId}/remind`, {})).json.statusMessage).toBe('Die Rechnung ist noch nicht fällig.')
    expect((await send('POST', `/api/erp/invoices/${invoiceId}/payments`, { paidOn: new Date().toISOString().slice(0, 10), amount: '35,00' })).status).toBe(200)
    let { invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${invoiceId}`)
    expect(invoice).toMatchObject({ paidCents: 3500, state: 'open' })
    await send('POST', `/api/erp/invoices/${invoiceId}/payments`, { paidOn: new Date().toISOString().slice(0, 10), amount: '100' })
    ;({ invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${invoiceId}`))
    expect(invoice.state).toBe('paid')
    expect(invoice.events.map(e => e.event)).toEqual(['created', 'finalized', 'sent', 'payment', 'payment'])
  })

  it('cancels with a Stornorechnung and keeps the hash chain intact', async () => {
    const second = await send('POST', '/api/erp/invoices', { customerId, deliveryDate: '2026-11-21', lines: [LINE, { ...LINE, name: 'Fahrt', quantity: '1', unit: 'LS', price: '20' }] })
    const id = second.json.id as number
    await send('POST', `/api/erp/invoices/${id}/finalize`)
    const cancelled = await send('POST', `/api/erp/invoices/${id}/cancel`, { reason: 'falscher Kunde' })
    expect(cancelled.json.number).toMatch(/-0003$/)
    expect((await send('POST', `/api/erp/invoices/${id}/cancel`, {})).json.statusMessage).toBe('Die Rechnung ist bereits storniert.')
    const { invoices } = await client.json<{ invoices: InvoiceSummary[] }>('/api/erp/invoices')
    expect(invoices.find(i => i.id === id)).toMatchObject({ state: 'cancelled', cancelledBy: cancelled.json.number })
    expect(invoices.find(i => i.id === cancelled.json.id)).toMatchObject({ type: '381', state: 'cancellation', grossCents: 15500 })
    const xml = await (await client.request(`/api/erp/invoices/${cancelled.json.id as number}/xml`)).text()
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(await client.json('/api/erp/invoices/verify')).toEqual({ count: 3, problems: [] })
  })

  it('reads an incoming e-invoice, refuses duplicates and flags a new IBAN', async () => {
    const pdf = Buffer.from(await (await client.request(`/api/erp/invoices/${invoiceId}/pdf`)).arrayBuffer())
    const form = new FormData()
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rechnung.pdf')
    form.append('category', 'services')
    const first = await upload('/api/erp/incoming', form)
    expect(first.status).toBe(200)
    expect(first.json.format).toBe('zugferd-pdf')
    const detail = await client.json<{ invoice: { supplierName: string, number: string, grossCents: number, iban: string }, parsed: { lines: unknown[] } }>(`/api/erp/incoming/${first.json.id as number}`)
    expect(detail.invoice).toMatchObject({ supplierName: 'Steuten IT Solutions', number: invoiceNumber, grossCents: 13500, iban: 'DE89370400440532013000' })
    expect(detail.parsed.lines).toHaveLength(1)
    expect((await upload('/api/erp/incoming', form)).json.statusMessage).toContain('bereits erfasst')

    // A photo needs the fields typed in; a different IBAN for the same supplier is flagged.
    const photo = new FormData()
    photo.append('file', new Blob([readFileSync(join(import.meta.dirname, '../../../tests/fixtures/logo.png'))], { type: 'image/png' }), 'beleg.png')
    photo.append('category', 'hosting')
    expect((await upload('/api/erp/incoming', photo)).json.statusMessage).toContain('keine E-Rechnung')
    for (const [k, v] of Object.entries({ supplierName: 'Steuten IT Solutions', number: 'X-1', issueDate: '2026-11-02', net: '10', tax: '1,90', iban: 'GB82 WEST 1234 5698 7654 32' })) photo.append(k, v)
    const second = await upload('/api/erp/incoming', photo)
    expect(second.status).toBe(200)
    expect((second.json.warnings as string[])[0]).toContain('weicht von früheren Rechnungen')

    expect((await send('POST', `/api/erp/incoming/${second.json.id as number}/discard`, { reason: 'Test' })).status).toBe(200)
    await expect(sql('DELETE FROM incoming_invoices WHERE id = ?', [second.json.id])).rejects.toThrow(/discarded, not deleted/)
  })

  it('turns a quote into an order and an invoice draft', async () => {
    const quote = await send('POST', '/api/erp/sales', { kind: 'quote', customerId, lines: [LINE] })
    const id = quote.json.id as number
    expect((await client.request(`/api/erp/sales/${id}/preview`)).headers.get('content-type')).toBe('application/pdf')
    expect((await send('POST', `/api/erp/sales/${id}/issue`)).json.number).toMatch(/^A-\d{4}-0001$/)
    expect((await send('PUT', `/api/erp/sales/${id}`, { kind: 'quote', customerId, lines: [LINE] })).status).toBe(422)
    const order = await send('POST', `/api/erp/sales/${id}/order`)
    const orderId = order.json.id as number
    expect((await send('POST', `/api/erp/sales/${orderId}/issue`)).json.number).toMatch(/^AB-\d{4}-0001$/)
    const invoice = await send('POST', `/api/erp/sales/${orderId}/invoice`)
    expect(invoice.status).toBe(200)
    expect((await send('POST', `/api/erp/sales/${orderId}/invoice`)).status).toBe(422)
    const { document } = await client.json<{ document: { status: string, invoiceId: number } }>(`/api/erp/sales/${orderId}`)
    expect(document).toMatchObject({ status: 'invoiced', invoiceId: invoice.json.invoiceId })
    expect((await send('POST', `/api/erp/sales/${orderId}/send`, {})).json.message).toContain('Auftragsbestätigung')
    // Deleting the draft frees the order again.
    await send('DELETE', `/api/erp/invoices/${invoice.json.invoiceId as number}`)
    expect((await client.json<{ document: { status: string } }>(`/api/erp/sales/${orderId}`)).document.status).toBe('sent')
  })

  it('bills time entries and recurring invoices as drafts', async () => {
    for (const day of ['2026-11-24', '2026-11-25']) {
      expect((await send('POST', '/api/erp/time', { workDate: day, customerId, description: `Arbeit ${day}`, quantity: '2', unit: 'HUR', price: '90', vatRate: 0 })).status).toBe(200)
    }
    const { entries } = await client.json<{ entries: { id: number }[] }>('/api/erp/time')
    const billed = await send('POST', '/api/erp/time/bill', { ids: entries.map(e => e.id) })
    const { invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${billed.json.invoiceId as number}`)
    expect(invoice).toMatchObject({ grossCents: 36000, deliveryDate: '2026-11-25', note: 'Leistungszeitraum 24.11.2026 – 25.11.2026' })
    expect(invoice.timeEntryIds).toHaveLength(2)
    expect((await send('DELETE', `/api/erp/time/${entries[0]!.id}`)).status).toBe(422)

    await send('POST', '/api/erp/subscriptions', { customerId, name: 'Wartung', intervalMonths: 1, nextDate: '2026-01-01', endDate: '2026-02-15', lines: [LINE] })
    // The background jobs catch up: January and February, then the plan has ended.
    expect((await send('POST', '/api/refresh', {})).status).toBe(200)
    const { subscriptions } = await client.json<{ subscriptions: { nextDate: string, active: boolean }[] }>('/api/erp/subscriptions')
    expect(subscriptions[0]).toMatchObject({ nextDate: '2026-03-01', active: false })
    const { invoices } = await client.json<{ invoices: InvoiceSummary[] }>('/api/erp/invoices')
    const drafts = invoices.filter(i => i.state === 'draft' && i.deliveryDate.startsWith('2026-0'))
    expect(drafts.map(i => i.deliveryDate).sort()).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('exports a ZIP and sums the year', async () => {
    const year = new Date().getFullYear()
    const response = await client.request(`/api/erp/export?from=${year}-01-01&to=${year}-12-31`)
    expect(response.headers.get('content-type')).toBe('application/zip')
    const file = join(dir, 'export.zip')
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    const listing = execFileSync('unzip', ['-l', file]).toString()
    expect(listing).toContain(`Ausgangsrechnungen/${invoiceNumber}.pdf`)
    expect(listing).toContain(`Ausgangsrechnungen/${invoiceNumber}.xml`)
    expect(listing).toContain('eingangsrechnungen.csv')
    expect(listing).toContain('Angebote_und_Auftraege/')
    expect(execFileSync('unzip', ['-p', file, 'LIESMICH.txt']).toString()).toContain('keine Abweichungen')
    const { report } = await client.json<{ report: { totals: { invoicedNet: number, received: number } } }>(`/api/erp/report?year=${year}`)
    // R-0001 (135,00) and R-0002 (155,00) minus its cancellation R-0003; received 135,00.
    expect(report.totals).toMatchObject({ invoicedNet: 13500, received: 13500 })
    expect(existsSync(mails)).toBe(true)
  })
})
