import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ImapFlow } from 'imapflow'
import { createPool } from 'mysql2/promise'
import { InvoiceEngine } from '../../server/lib/erp/engine'
import { fetchMailbox } from '../../server/lib/erp/mailbox'
import type { IncomingMailFile, InvoiceDetail, InvoiceSummary, MailboxSettings } from '../../shared/types/erp'
import { type Client, loggedIn } from './client'
import { BASE, databaseUrl, resetDatabase, sql, startServer, stopServer } from './setup'

// The ERP end to end: the built server, MariaDB and the PHP e-invoice engine (bin/invoice.php).

const dir = mkdtempSync(join(tmpdir(), 'cockpit-erp-'))
const mails = join(dir, 'mails')
const sendmail = join(dir, 'sendmail')

const SETTINGS = {
  name: 'Steuten IT Solutions', contactName: 'Christian Steuten', street: 'Musterweg 1', postcode: '48143', city: 'Münster', country: 'DE',
  email: 'info@example.org', vatId: 'DE463748776', iban: 'DE89 3704 0044 0532 0130 00', smallBusiness: true, paymentDays: 14,
  mailFrom: 'Steuten IT Solutions <rechnung@example.org>', mailFromOrder: 'Steuten IT Solutions <info@example.org>', mailText: 'Anbei {dokument} {nummer} über {betrag}.',
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
    const created = await send('POST', '/api/erp/customers', { kind: 'business', name: 'Kunde GmbH', contactName: 'Erika Kunde', street: 'Weg 2', postcode: '10115', city: 'Berlin', email: 'kunde@example.org', projectId: '1' })
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
    const hostile = new FormData()
    hostile.append('logo', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'logo.svg')
    expect((await upload('/api/erp/logo', hostile)).json.statusMessage).toContain('Skripte')
    // An SVG is stored (and printed on the invoices below) as PNG.
    const svg = new FormData()
    svg.append('logo', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="40" height="40" rx="8" fill="#0a5"/><path d="M50 10h60v20H50z" fill="#06c"/></svg>'], { type: 'image/svg+xml' }), 'logo.svg')
    expect((await upload('/api/erp/logo', svg)).json.message).toBe('Logo gespeichert.')
    const stored = await client.request('/api/erp/logo')
    expect(stored.headers.get('content-type')).toBe('image/png')
  })

  it('writes, previews and finalizes an invoice', async () => {
    const draft = await send('POST', '/api/erp/invoices', { customerId, projectId: '1', deliveryDate: '2026-11-20', paymentDays: 14, note: 'Danke', lines: [LINE] })
    expect(draft.status).toBe(200)
    invoiceId = draft.json.id as number
    const preview = await client.request(`/api/erp/invoices/${invoiceId}/preview`)
    expect(preview.headers.get('content-type')).toBe('application/pdf')
    const previewPdf = Buffer.from(await preview.arrayBuffer())
    expect(previewPdf.subarray(0, 5).toString()).toBe('%PDF-')
    // The customer's contact person is printed below its name.
    expect(execFileSync('pdftotext', ['-', '-'], { input: previewPdf }).toString()).toMatch(/Kunde GmbH\s+Erika Kunde\s+Weg 2/)

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
    expect(mail).toContain('From: Steuten IT Solutions <rechnung@example.org>')
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

  it('takes incoming invoices from the mailbox', async () => {
    expect((await send('PUT', '/api/erp/mailbox', { host: 'mail.example.org', user: 'eingang@example.org' })).json.statusMessage).toContain('Passwort')
    expect((await send('PUT', '/api/erp/mailbox', { host: 'mail.example.org', user: 'eingang@example.org', password: 'geheim' })).status).toBe(200)
    expect(await client.json<MailboxSettings>('/api/erp/mailbox')).toEqual({ host: 'mail.example.org', user: 'eingang@example.org', hasPassword: true })
    expect(((await sql('SELECT imap_secret AS s FROM company_settings')) as { s: string }[])[0]!.s).not.toContain('geheim')

    // Three messages: the Stornorechnung (an e-invoice) with a small signature logo, a plain
    // PDF forwarded as attachment, and a mail without any file.
    const { invoices } = await client.json<{ invoices: InvoiceSummary[] }>('/api/erp/invoices')
    const credit = invoices.find(i => i.type === '381')!
    const eInvoice = Buffer.from(await (await client.request(`/api/erp/invoices/${credit.id}/pdf`)).arrayBuffer())
    const part = (type: string, name: string, data: Buffer, disposition = 'attachment') =>
      `--b\r\nContent-Type: ${type}; name="${name}"\r\nContent-Disposition: ${disposition}; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data.toString('base64')}\r\n`
    const mail = (subject: string, parts: string[]) => Buffer.from(`From: Lieferant <rechnung@lieferant.example>\r\nTo: eingang@example.org\r\nSubject: ${subject}\r\n`
      + `Message-ID: <${subject.replace(/\W/g, '')}@example>\r\nDate: Fri, 27 Nov 2026 08:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n`
      + `--b\r\nContent-Type: text/plain\r\n\r\nAnbei die Rechnung.\r\n${parts.join('')}--b--\r\n`)
    const plain = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    const inner = mail('Rechnung Papier', [part('application/pdf', 'scan.pdf', plain)])
    const messages = new Map<number, Buffer>([
      [11, mail('Gutschrift', [part('application/pdf', 'gutschrift.pdf', eInvoice), part('image/png', 'logo.png', readFileSync(join(import.meta.dirname, '../../../tests/fixtures/logo.png')), 'inline')])],
      [12, mail('WG: Rechnung', [part('message/rfc822', 'weitergeleitet.eml', inner)])],
      [13, mail('Hallo', [])],
    ])
    const moved: [number, string][] = []
    const created: string[] = []
    const fake = {
      connect: async () => {},
      list: async () => created.map(path => ({ path })),
      mailboxCreate: async (path: string) => { created.push(path) },
      getMailboxLock: async () => ({ release: () => {} }),
      search: async () => [...messages.keys()],
      fetchOne: async (uid: string) => ({ source: messages.get(Number(uid)), size: messages.get(Number(uid))!.length }),
      messageMove: async (uid: string, folder: string) => { moved.push([Number(uid), folder]) },
      logout: async () => {},
      close: () => {},
    } as unknown as ImapFlow
    const pool = createPool(databaseUrl)
    try {
      const engine = new InvoiceEngine('php', join(import.meta.dirname, '../../..'))
      const result = await fetchMailbox({ host: 'x', user: 'y', password: 'z' }, pool, engine, '2026-11-27 08:05:00', () => fake)
      expect(result).toEqual({ messages: 3, booked: 1, waiting: 1, ignored: 0 })
      expect(moved).toEqual([[11, 'Verarbeitet'], [12, 'Verarbeitet'], [13, 'Ohne Rechnung']])
      // The same file again (e.g. forwarded twice) is not taken twice.
      moved.length = 0
      expect(await fetchMailbox({ host: 'x', user: 'y', password: 'z' }, pool, engine, '2026-11-27 08:20:00', () => fake)).toEqual({ messages: 3, booked: 0, waiting: 0, ignored: 2 })
    }
    finally {
      await pool.end()
    }

    // The e-invoice is entered; the plain PDF waits and is entered with typed-in fields.
    const list = await client.json<{ invoices: { number: string }[], mailFiles: IncomingMailFile[] }>('/api/erp/incoming')
    expect(list.invoices.map(i => i.number)).toContain(credit.number)
    expect(list.mailFiles).toHaveLength(1)
    const waiting = list.mailFiles[0]!
    expect(waiting).toMatchObject({ fileName: 'scan.pdf', sender: 'Lieferant <rechnung@lieferant.example>', subject: 'Rechnung Papier', status: 'new' })
    const form = new FormData()
    form.append('file', new Blob([await (await client.request(`/api/erp/incoming/mail/${waiting.id}`)).arrayBuffer()], { type: 'application/pdf' }), 'scan.pdf')
    for (const [k, v] of Object.entries({ mailFileId: String(waiting.id), category: 'other', supplierName: 'Lieferant', number: 'P-7', issueDate: '2026-11-20', net: '50', tax: '0' })) form.append(k, v)
    expect((await upload('/api/erp/incoming', form)).status).toBe(200)
    expect((await client.json<{ mailFiles: IncomingMailFile[] }>('/api/erp/incoming')).mailFiles).toHaveLength(0)
    expect((await send('POST', `/api/erp/incoming/mail/${waiting.id}/ignore`)).status).toBe(422)

    // A waiting file that was uploaded by hand instead of via "Erfassen" stops waiting;
    // one refused because its number is in the books already keeps waiting to be corrected.
    const insertMailFile = async (content: Buffer) => ((await sql(`INSERT INTO incoming_mail_files (file_name, file_type, sha256, content, status, created_at, updated_at)
      VALUES ('b.pdf', 'application/pdf', SHA2(?, 256), ?, 'new', NOW(), NOW()) RETURNING id`, [content, content])) as [{ id: number }])[0].id
    const other = Buffer.from('%PDF-1.4\n% andere Datei\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    const byHand = await insertMailFile(other)
    const twin = await insertMailFile(Buffer.from('%PDF-1.4\n% Kopie\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'))
    expect((await client.json<{ mailFiles: IncomingMailFile[] }>('/api/erp/incoming')).mailFiles.map(m => m.id)).toEqual([byHand, twin])
    const entry = (content: Buffer, extra: Record<string, string>) => {
      const f = new FormData()
      f.append('file', new Blob([content], { type: 'application/pdf' }), 'b.pdf')
      for (const [k, v] of Object.entries({ category: 'other', supplierName: 'Lieferant', number: 'P-8', issueDate: '2026-11-20', net: '20', tax: '0', ...extra })) f.append(k, v)
      return upload('/api/erp/incoming', f)
    }
    expect((await entry(other, {})).status).toBe(200)
    expect((await sql('SELECT status FROM incoming_mail_files WHERE id = ?', [byHand]))).toEqual([{ status: 'booked' }])
    const refused = await entry(Buffer.from('%PDF-1.4\n% Kopie\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), { mailFileId: String(twin), number: 'P-7' })
    expect(refused.status).toBe(422)
    expect((await client.json<{ mailFiles: IncomingMailFile[] }>('/api/erp/incoming')).mailFiles.map(m => m.id)).toEqual([twin])
    // A credit note may carry the number of the supplier's invoice it refers to.
    expect((await entry(Buffer.from('%PDF-1.4\n% Kopie\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), { mailFileId: String(twin), number: 'P-7', kind: 'credit' })).status).toBe(200)
    expect((await sql('SELECT status FROM incoming_mail_files WHERE id = ?', [twin]))).toEqual([{ status: 'booked' }])
    // An ignored file can be put back on the list.
    const ignored = await insertMailFile(Buffer.from('%PDF-1.4\n% ignoriert\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'))
    expect((await send('POST', `/api/erp/incoming/mail/${ignored}/ignore`)).status).toBe(200)
    expect((await client.json<{ ignoredMailFiles: IncomingMailFile[] }>('/api/erp/incoming')).ignoredMailFiles.map(m => m.id)).toContain(ignored)
    expect((await send('POST', `/api/erp/incoming/mail/${ignored}/restore`)).status).toBe(200)
    expect((await send('POST', `/api/erp/incoming/mail/${ignored}/restore`)).status).toBe(422)
    expect((await client.json<{ mailFiles: IncomingMailFile[] }>('/api/erp/incoming')).mailFiles.map(m => m.id)).toEqual([ignored])
    expect((await send('POST', `/api/erp/incoming/mail/${ignored}/ignore`)).status).toBe(200)

    // A received XML is shown as text, never as a document the browser would run.
    const [{ id: xmlId }] = (await sql(`INSERT INTO incoming_mail_files (file_name, file_type, sha256, content, status, created_at, updated_at)
      VALUES ('x.xml', 'application/xml', REPEAT('a', 64), '<x/>', 'new', NOW(), NOW()) RETURNING id`)) as [{ id: number }]
    expect((await client.request(`/api/erp/incoming/mail/${xmlId}`)).headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect((await send('POST', `/api/erp/incoming/mail/${xmlId}/ignore`)).status).toBe(200)
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
    // Order confirmations have their own sender in SETTINGS.
    expect(readFileSync(mails, 'utf8').split('----').at(-2)).toContain('From: Steuten IT Solutions <info@example.org>')
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

  it('gives line discounts and credits part of an invoice', async () => {
    // 4 h at 90 € with 12,5 % off: 360 € − 45 € = 315 €.
    const draft = await send('POST', '/api/erp/invoices', { customerId, deliveryDate: '2026-11-25', lines: [{ ...LINE, quantity: '4', discount: '12,5' }] })
    expect((await send('POST', '/api/erp/invoices', { customerId, deliveryDate: '2026-11-25', lines: [{ ...LINE, discount: '120' }] })).json.statusMessage).toContain('Rabatt')
    const id = draft.json.id as number
    await send('POST', `/api/erp/invoices/${id}/finalize`)
    let { invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${id}`)
    expect(invoice).toMatchObject({ grossCents: 31500, lines: [{ discountBp: 1250 }] })
    const xml = await (await client.request(`/api/erp/invoices/${id}/xml`)).text()
    expect(xml).toContain('<ram:CalculationPercent>12.50</ram:CalculationPercent>')
    expect(xml).toContain('<ram:LineTotalAmount>315.00</ram:LineTotalAmount>')

    // Credit one of the four hours (78,75 € after the discount), then try to credit too much.
    const correction = await send('POST', `/api/erp/invoices/${id}/correct`, { lines: [{ ...LINE, quantity: '1', discount: '12,5' }], reason: 'eine Stunde zu viel' })
    expect(correction.json.message).toMatch(/^Rechnungskorrektur R-/)
    expect((await send('POST', `/api/erp/invoices/${id}/correct`, { lines: [{ ...LINE, quantity: '4' }] })).json.statusMessage).toContain('höher als')
    expect((await send('POST', `/api/erp/invoices/${id}/cancel`, {})).json.statusMessage).toContain('Rechnungskorrektur')
    ;({ invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${id}`))
    expect(invoice).toMatchObject({ state: 'open', creditedCents: 7875, cancelledBy: null, related: [{ correction: true, grossCents: 7875 }] })
    const credit = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${correction.json.id as number}`)
    expect(credit.invoice).toMatchObject({ type: '381', state: 'correction', correction: true, precedingNumber: invoice.number })
    const creditXml = await (await client.request(`/api/erp/invoices/${correction.json.id as number}/xml`)).text()
    expect(creditXml).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(creditXml).toContain(`<ram:IssuerAssignedID>${invoice.number}</ram:IssuerAssignedID>`)
    // Paying the rest settles the invoice.
    await send('POST', `/api/erp/invoices/${id}/payments`, { paidOn: new Date().toISOString().slice(0, 10), amount: '236,25' })
    ;({ invoice } = await client.json<{ invoice: InvoiceDetail }>(`/api/erp/invoices/${id}`))
    expect(invoice.state).toBe('paid')
    expect((await client.json<{ problems: string[] }>('/api/erp/invoices/verify')).problems).toEqual([])
  })

  it('suggests the fields of an invoice without e-invoice data, from its text or by OCR', async () => {
    // A quote is a PDF with text but without e-invoice data, like many supplier invoices.
    const quote = await send('POST', '/api/erp/sales', { kind: 'quote', customerId, lines: [{ ...LINE, quantity: '2' }] })
    const pdf = Buffer.from(await (await client.request(`/api/erp/sales/${quote.json.id as number}/preview`)).arrayBuffer())
    const suggest = async (data: Buffer, name: string, type: string) => {
      const form = new FormData()
      form.append('file', new Blob([data], { type }), name)
      return (await upload('/api/erp/incoming/extract', form)).json as { einvoice: boolean, source: string | null, problem: string | null, fields: Record<string, unknown> | null }
    }
    const fromText = await suggest(pdf, 'rechnung.pdf', 'application/pdf')
    expect(fromText).toMatchObject({ einvoice: false, source: 'pdf', problem: null, fields: { netCents: 18000, taxCents: 0, grossCents: 18000 } })

    // The same page as a photo: read by Tesseract.
    const scan = join(dir, 'scan')
    execFileSync('pdftoppm', ['-r', '200', '-gray', '-png', '-f', '1', '-l', '1', '-', scan], { input: pdf })
    const fromPhoto = await suggest(readFileSync(`${scan}-1.png`), 'foto.png', 'image/png')
    expect(fromPhoto).toMatchObject({ einvoice: false, source: 'ocr', fields: { grossCents: 18000 } })

    // An e-invoice needs no suggestions.
    const einvoice = Buffer.from(await (await client.request(`/api/erp/invoices/${invoiceId}/pdf`)).arrayBuffer())
    expect(await suggest(einvoice, 'e.pdf', 'application/pdf')).toMatchObject({ einvoice: true, fields: null })
  })

  it('splits an incoming invoice across projects', async () => {
    await sql(`INSERT INTO projects (id, full_name, owner, name, html_url, is_private, is_archived, is_fork, default_branch, synced_at, hidden)
      VALUES (2, 'Org/web', 'Org', 'web', 'https://github.com/Org/web', 1, 0, 0, 'main', NOW(), 0)`)
    const year = new Date().getFullYear()
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n% Server\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], { type: 'application/pdf' }), 'server.pdf')
    const fields = { category: 'hosting', supplierName: 'Hoster', number: 'H-1', issueDate: `${year}-03-01`, net: '100,01', tax: '19,00',
      projects: JSON.stringify([{ projectId: '1', share: '60' }, { projectId: '2', share: '40' }]) }
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    const created = await upload('/api/erp/incoming', form)
    expect(created.status).toBe(200)
    const id = created.json.id as number
    const detail = () => client.json<{ invoice: { projectId: number | null, projects: { projectId: number, shareBp: number }[] } }>(`/api/erp/incoming/${id}`)
    expect((await detail()).invoice).toMatchObject({ projectId: 1, projects: [{ projectId: 1, shareBp: 6000 }, { projectId: 2, shareBp: 4000 }] })

    // The evaluation counts 60,01 € for app and 40,00 € for web: the parts add up to the net.
    const expenses = async () => (await client.json<{ report: { projects: { name: string, expenses: number }[] } }>(`/api/erp/report?year=${year}`)).report.projects
    const before = await expenses()
    const of = (list: { name: string, expenses: number }[], name: string) => list.find(p => p.name === name)?.expenses ?? 0
    expect(of(before, 'web')).toBe(4000)

    const base = { number: 'H-1', issueDate: `${year}-03-01`, net: '100,01', tax: '19,00', category: 'hosting', iban: '', note: '' }
    expect((await send('PUT', `/api/erp/incoming/${id}`, { ...base, projects: [{ projectId: '1', share: '70' }, { projectId: '2', share: '20' }] })).json.statusMessage).toContain('100 %')
    expect((await send('PUT', `/api/erp/incoming/${id}`, { ...base, projects: [{ projectId: '2', share: '' }] })).status).toBe(200)
    expect((await detail()).invoice).toMatchObject({ projectId: 2, projects: [{ projectId: 2, shareBp: 10000 }] })
    const after = await expenses()
    expect(of(after, 'web')).toBe(10001)
    expect(of(after, 'app')).toBe(of(before, 'app') - 6001)
  })

  it('records an incoming invoice in US dollars with the euros paid', async () => {
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n% USD\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], { type: 'application/pdf' }), 'usd.pdf')
    for (const [k, v] of Object.entries({ category: 'software', supplierName: 'US Inc.', number: 'INV-9', issueDate: '2026-11-03', net: '100,00', tax: '0', currency: 'USD', euroGross: '80,00' })) form.append(k, v)
    const created = await upload('/api/erp/incoming', form)
    expect(created.status).toBe(200)
    const id = created.json.id as number
    const { invoice } = await client.json<{ invoice: Record<string, unknown> }>(`/api/erp/incoming/${id}`)
    expect(invoice).toMatchObject({ netCents: 8000, grossCents: 8000, currency: 'USD', originalNetCents: 10000, originalTaxCents: 0, exchangeRate: 1.25 })
    // Back to euros: the originals go.
    const base = { number: 'INV-9', issueDate: '2026-11-03', net: '81,00', tax: '0', category: 'software', iban: '', note: '', currency: 'EUR', euroGross: '' }
    expect((await send('PUT', `/api/erp/incoming/${id}`, base)).status).toBe(200)
    expect((await client.json<{ invoice: Record<string, unknown> }>(`/api/erp/incoming/${id}`)).invoice).toMatchObject({ netCents: 8100, currency: 'EUR', exchangeRate: null })
  })

  it('records a credit note of a supplier that lowers the expenses', async () => {
    const year = new Date().getFullYear()
    const { invoices } = await client.json<{ invoices: { id: number, number: string, supplierName: string }[] }>('/api/erp/incoming')
    const original = invoices.find(i => i.number === 'H-1')!
    const other = invoices.find(i => i.number === 'INV-9')!
    const expenses = async () => (await client.json<{ report: { projects: { name: string, expenses: number }[] } }>(`/api/erp/report?year=${year}`)).report.projects
      .find(p => p.name === 'web')?.expenses ?? 0
    const before = await expenses()
    const credit = (relatedId: number, name: string) => {
      const form = new FormData()
      form.append('file', new Blob([Buffer.from(`%PDF-1.4\n% Credit ${relatedId}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`)], { type: 'application/pdf' }), name)
      const fields = { category: 'hosting', supplierName: 'Hoster', number: 'G-1', issueDate: `${year}-03-10`, net: '20,00', tax: '3,80',
        kind: 'credit', relatedId: String(relatedId), projects: JSON.stringify([{ projectId: '2', share: '' }]) }
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      return upload('/api/erp/incoming', form)
    }
    // An invoice of another supplier is refused.
    expect((await credit(other.id, 'wrong.pdf')).json.statusMessage).toContain('selben Lieferanten')
    const created = await credit(original.id, 'credit.pdf')
    expect(created.status).toBe(200)
    const id = created.json.id as number
    const detail = await client.json<{ invoice: Record<string, unknown> }>(`/api/erp/incoming/${id}`)
    expect(detail.invoice).toMatchObject({ kind: 'credit', relatedId: original.id, grossCents: 2380 })
    expect(await expenses()).toBe(before - 2000)
    // The original lists it, and cannot become a credit note itself.
    const page = await client.json<{ siblings: { id: number, relatedId: number | null }[] }>(`/api/erp/incoming/${original.id}`)
    expect(page.siblings.find(s => s.id === id)?.relatedId).toBe(original.id)
    const base = { number: 'H-1', issueDate: `${year}-03-01`, net: '100,01', tax: '19,00', category: 'hosting', iban: '', note: '', kind: 'credit', relatedId: '' }
    expect((await send('PUT', `/api/erp/incoming/${original.id}`, base)).json.statusMessage).toContain('Gutschriften')
    // Marked as refunded, it counts as paid back in the export.
    expect((await send('POST', `/api/erp/incoming/${id}/paid`, { paidOn: `${year}-03-12` })).status).toBe(200)
  })
})
