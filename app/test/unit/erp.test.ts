import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, csvAmount, csvRow, daysBetween, documentNumber, euro, invoiceState, isoDate, isValidIban, lineDiscount, lineFromForm, lineNet, openAmount, parsePercent, percentText,
  linesFromForm, mailText, parseQuantity, senderFor, period, priceText, quantity, reminderText, totals,
} from '../../shared/lib/erp'
import { nextReminder } from '../../server/lib/erp/dunning'
import { chainHash, correctionProblem, finalizeProblem } from '../../server/lib/erp/invoices'
import { customerFromBody, incomingFromBody, settingsFromBody, timeFromBody } from '../../server/lib/erp/forms'
import { incomingType, logoType } from '../../server/lib/erp/files'
import { isSvg, svgProblem, svgToPng } from '../../server/lib/erp/logo'
import { mimeMessage } from '../../server/lib/erp/mail'
import { entryLine } from '../../server/lib/erp/timeEntries'
import { crc32, zip } from '../../server/lib/erp/zip'
import type { CompanySettings, InvoiceDetail } from '../../shared/types/erp'

// The ERP's pure rules. The amounts must agree with the PHP e-invoice code
// (src/Invoicing/InvoiceLine.php, Invoice.php), which prints PDF and XML.

describe('amounts', () => {
  it('rounds a line half up to the cent', () => {
    expect(lineNet({ quantityMilli: 1500, unitPriceCents: 9000 })).toBe(13500)
    expect(lineNet({ quantityMilli: 333, unitPriceCents: 1 })).toBe(0) // 0,333 ct
    expect(lineNet({ quantityMilli: 500, unitPriceCents: 1 })).toBe(1) // 0,5 ct rounds up
    expect(lineNet({ quantityMilli: 1250, unitPriceCents: 999 })).toBe(1249) // 12,4875 €
    // Same figures as tests/Unit/InvoicingTest.php, so screen and PDF agree.
    expect(lineDiscount({ quantityMilli: 2000, unitPriceCents: 2490, discountBp: 1000 })).toBe(498)
    expect(lineNet({ quantityMilli: 2000, unitPriceCents: 2490, discountBp: 1000 })).toBe(4482)
    expect(lineDiscount({ quantityMilli: 1000, unitPriceCents: 5, discountBp: 1250 })).toBe(1) // 0,625 ct rounds up
    expect(lineNet({ quantityMilli: 1000, unitPriceCents: 5000, discountBp: 10000 })).toBe(0)
    expect(parsePercent('')).toBe(0)
    expect(parsePercent('0,25')).toBe(25)
    expect(parsePercent('100')).toBe(10000)
    expect(parsePercent('100,01')).toBeNull()
    expect(parsePercent('1,234')).toBeNull()
    expect(percentText(1250)).toBe('12,5')
    expect(percentText(0)).toBe('')
  })

  it('computes the tax per rate on the sum of its lines', () => {
    const t = totals([
      { quantityMilli: 1000, unitPriceCents: 1005, vatRate: 19 },
      { quantityMilli: 1000, unitPriceCents: 1005, vatRate: 19 },
      { quantityMilli: 1000, unitPriceCents: 1000, vatRate: 7 },
      { quantityMilli: 1000, unitPriceCents: 500, vatRate: 0 },
    ])
    // 20,10 € × 19 % = 3,819 € → 3,82 €
    expect(t.groups.map(g => [g.rate, g.basis, g.tax])).toEqual([[19, 2010, 382], [7, 1000, 70], [0, 500, 0]])
    expect(t).toMatchObject({ net: 3510, tax: 452, gross: 3962 })
    // Three lines of 0,15 € at 19 %: 0,45 € × 19 % = 0,0855 € → 0,09 €.
    expect(totals([1, 2, 3].map(() => ({ quantityMilli: 1000, unitPriceCents: 15, vatRate: 19 }))).tax).toBe(9)
  })

  it('reads and writes German quantities and prices', () => {
    expect(parseQuantity('1,5')).toBe(1500)
    expect(parseQuantity('0,25')).toBe(250)
    expect(parseQuantity('1.000')).toBe(1_000_000)
    expect(parseQuantity('2')).toBe(2000)
    expect(parseQuantity('0')).toBeNull()
    expect(parseQuantity('1,2345')).toBeNull()
    expect(parseQuantity('-1')).toBeNull()
    expect(quantity(1500)).toBe('1,5')
    expect(quantity(1_000_000)).toBe('1.000')
    expect(quantity(250)).toBe('0,25')
    expect(euro(123450)).toBe('1.234,50 €')
    expect(euro(-500)).toBe('-5,00 €')
    expect(priceText(123450)).toBe('1234,50')
  })

  it('validates lines with German messages', () => {
    const ok = { name: 'Beratung', description: '', quantity: '1,5', unit: 'HUR', price: '90', vatRate: 0, discount: '' }
    expect(lineFromForm(ok, 1, true)).toEqual({ name: 'Beratung', description: null, quantityMilli: 1500, unit: 'HUR', unitPriceCents: 9000, vatRate: 0, discountBp: 0 })
    expect(lineFromForm({ ...ok, discount: '12,5 %' }, 1, true)).toMatchObject({ discountBp: 1250 })
    expect(lineFromForm({ ...ok, discount: '101' }, 4, true)).toContain('Position 4: Der Rabatt')
    expect(lineFromForm({ ...ok, discount: '-5' }, 4, true)).toContain('Der Rabatt')
    expect(lineFromForm({ ...ok, vatRate: 19 }, 2, true)).toContain('Kleinunternehmer')
    expect(lineFromForm({ ...ok, unit: 'XYZ' }, 3, false)).toBe('Position 3: Unbekannte Einheit.')
    expect(lineFromForm({ ...ok, name: '  ' }, 1, false)).toContain('Bezeichnung')
    expect(linesFromForm([], false)).toBe('Bitte mindestens eine Position erfassen.')
    expect(linesFromForm(Array.from({ length: 101 }, () => ok), true)).toBe('Höchstens 100 Positionen.')
  })
})

describe('dates and numbers', () => {
  it('handles calendar dates without time zone surprises', () => {
    expect(isoDate('2026-02-29')).toBeNull()
    expect(isoDate('2028-02-29')).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // over the change to summer time
    expect(period('2026-12-01', 1)).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(period('2026-01-31', 1)).toEqual({ from: '2026-01-31', to: '2026-02-27' })
    expect(period('2026-01-01', 12)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('formats document numbers per kind and year', () => {
    expect(documentNumber('invoice', 2026, 1)).toBe('R-2026-0001')
    expect(documentNumber('quote', 2026, 12)).toBe('A-2026-0012')
    expect(documentNumber('order', 2027, 10000)).toBe('AB-2027-10000')
  })

  it('checks IBANs with mod 97', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('DE89370400440532013001')).toBe(false)
  })
})

describe('invoice state', () => {
  const base = { status: 'final', type: '380', grossCents: 10000, paidCents: 0, dueDate: '2026-11-20', cancelled: false }
  it('derives the state from payments, due date and cancellation', () => {
    expect(invoiceState({ ...base, status: 'draft' }, '2026-11-26')).toBe('draft')
    expect(invoiceState(base, '2026-11-20')).toBe('open')
    expect(invoiceState(base, '2026-11-21')).toBe('overdue')
    expect(invoiceState({ ...base, paidCents: 5000 }, '2026-11-21')).toBe('overdue')
    expect(invoiceState({ ...base, paidCents: 10000 }, '2026-11-21')).toBe('paid')
    expect(invoiceState({ ...base, cancelled: true }, '2026-11-21')).toBe('cancelled')
    expect(invoiceState({ ...base, type: '381' }, '2026-11-21')).toBe('cancellation')
    expect(invoiceState({ ...base, type: '381', correction: true }, '2026-11-21')).toBe('correction')
    // A Rechnungskorrektur lowers what is owed: 60 € paid plus 40 € credited settle 100 €.
    expect(invoiceState({ ...base, paidCents: 6000, creditedCents: 4000 }, '2026-11-21')).toBe('paid')
    expect(openAmount({ grossCents: 10000, paidCents: 6000, creditedCents: 1000 })).toBe(3000)
    expect(openAmount({ grossCents: 10000, paidCents: 10000, creditedCents: 1000 })).toBe(0)
  })

  it('limits a Rechnungskorrektur to the invoice', () => {
    const line = { name: 'Beratung', description: null, quantityMilli: 2000, unit: 'HUR', unitPriceCents: 10000, vatRate: 19, discountBp: 0 }
    const invoice = [line]
    expect(correctionProblem(invoice, [{ ...line, quantityMilli: 1000 }], 23800, false)).toBeNull()
    expect(correctionProblem(invoice, [], 23800, false)).toContain('mindestens eine Position')
    expect(correctionProblem(invoice, [{ ...line, vatRate: 7 }], 23800, false)).toContain('keine Position mit 7 %')
    expect(correctionProblem(invoice, [{ ...line, unitPriceCents: 0 }], 23800, false)).toContain('größer als 0')
    // 2 h at 100 € plus 19 % = 238 €; after a credit of 119 € only 119 € are left.
    expect(correctionProblem(invoice, [line], 11900, false)).toContain('höher als der noch nicht gutgeschriebene Betrag')
    expect(correctionProblem([{ ...line, vatRate: 0 }], [{ ...line, vatRate: 19 }], 99999, true)).toContain('Kleinunternehmer')
  })

  it('names what keeps a draft from being finalized', () => {
    const settings = {} as CompanySettings
    const line = { name: 'X', description: null, quantityMilli: 1000, unit: 'C62', unitPriceCents: 100, vatRate: 19 }
    expect(finalizeProblem([line], null, true, null)).toContain('Firmendaten')
    expect(finalizeProblem([], settings, true, null)).toContain('keine Positionen')
    expect(finalizeProblem([line], settings, true, null)).toContain('§ 19 UStG')
    expect(finalizeProblem([{ ...line, vatRate: 0 }], settings, false, null)).toContain('Befreiungsgrund')
    expect(finalizeProblem([line], settings, false, null)).toBeNull()
  })

  it('chains invoices by hash', () => {
    const first = chainHash(null, 'R-2026-0001', 'a'.repeat(64), 'b'.repeat(64))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(chainHash(first, 'R-2026-0002', 'c'.repeat(64), 'd'.repeat(64))).not.toBe(chainHash(null, 'R-2026-0002', 'c'.repeat(64), 'd'.repeat(64)))
  })
})

describe('texts', () => {
  it('fills the mail template', () => {
    expect(mailText('{dokument} {nummer} über {betrag}, fällig {faellig}. {absender} {unbekannt}', {
      document: 'Rechnung', number: 'R-2026-0001', grossCents: 13500, dueDate: '2026-12-10', sender: 'Christian',
    })).toBe('Rechnung R-2026-0001 über 135,00 €, fällig 10.12.2026. Christian {unbekannt}')
  })

  it('writes reminders with amount, deadline and account', () => {
    const text = reminderText({ level: 2, number: 'R-2026-0001', issueDate: '2026-11-01', dueDate: '2026-11-15', openCents: 13500, newDueDate: '2026-12-06', sellerName: 'Steuten IT Solutions', iban: 'DE89370400440532013000', contactName: 'Christian Steuten' })
    expect(text).toContain('trotz unserer Zahlungserinnerung')
    expect(text).toContain('135,00 €')
    expect(text).toContain('06.12.2026')
    expect(text).toContain('DE89 3704 0044 0532 0130 00')
  })

  it('protects CSV against formulas but keeps numbers', () => {
    expect(csvRow(['a;b', 'say "hi"', null, 3])).toBe('"a;b";"say ""hi""";;3')
    expect(csvRow(['=HYPERLINK("x")', '-12,50', '+49 251', '@SUM'])).toBe('"\'=HYPERLINK(""x"")";-12,50;\'+49 251;\'@SUM')
    expect(csvAmount(-123450)).toBe('-1234,50')
  })

  it('turns a time entry into a position', () => {
    expect(entryLine({ workDate: '2026-11-26', description: 'Server eingerichtet\nmit Backup', quantityMilli: 2500, unit: 'HUR', unitPriceCents: 9000, vatRate: 0 }))
      .toEqual({ name: 'Server eingerichtet', description: 'Leistung am 26.11.2026\nmit Backup', quantityMilli: 2500, unit: 'HUR', unitPriceCents: 9000, vatRate: 0, discountBp: 0 })
  })
})

describe('forms', () => {
  it('validates customers', () => {
    const body = { kind: 'business', name: 'Kunde GmbH', street: 'Weg 1', postcode: '48143', city: 'Münster', vatId: 'de 123456789', projectId: '' }
    expect(customerFromBody(body, [])).toMatchObject({ country: 'DE', vatId: 'DE123456789', projectId: null })
    expect(customerFromBody({ ...body, postcode: '4814' }, [])).toBe('Eine deutsche PLZ hat fünf Ziffern.')
    expect(customerFromBody({ ...body, kind: 'private' }, [])).toMatchObject({ vatId: null })
    expect(customerFromBody({ ...body, projectId: '7' }, [])).toBe('Unbekanntes Projekt.')
  })

  it('requires the mandatory invoice details of the company', () => {
    const body = { name: 'Steuten IT Solutions', street: 'Weg 1', postcode: '48143', city: 'Münster', vatId: 'DE463748776', iban: 'DE89 3704 0044 0532 0130 00', paymentDays: 14, smallBusiness: true }
    expect(settingsFromBody(body)).toMatchObject({ iban: 'DE89370400440532013000', smallBusiness: true })
    expect(settingsFromBody({ ...body, vatId: '' })).toContain('§ 14 Abs. 4 UStG')
    expect(settingsFromBody({ ...body, iban: 'DE00' })).toBe('Die IBAN ist ungültig.')
    expect(settingsFromBody({ ...body, mailFrom: 'Steuten IT <rechnung@example.org>' })).toMatchObject({ mailFrom: 'Steuten IT <rechnung@example.org>' })
    expect(settingsFromBody({ ...body, mailFrom: 'kein Absender' })).toContain('Absender')
    expect(settingsFromBody({ ...body, mailFromQuote: 'Info <info@example.org>' })).toMatchObject({ mailFromQuote: 'Info <info@example.org>', mailFromInvoice: null })
    expect(settingsFromBody({ ...body, mailFromReminder: 'mahnung' })).toContain('Zahlungserinnerungen und Mahnungen')
  })

  it('takes the sender of the document kind, else the general one', () => {
    const senders = { mailFrom: 'A <rechnung@example.org>', mailFromInvoice: null, mailFromCancellation: null, mailFromReminder: null, mailFromQuote: 'B <info@example.org>', mailFromOrder: null }
    expect(senderFor(senders, 'quote')).toBe('B <info@example.org>')
    expect(senderFor(senders, 'invoice')).toBe('A <rechnung@example.org>')
    expect(senderFor({ ...senders, mailFrom: null }, 'order')).toBeNull()
  })

  it('validates incoming invoices and time entries', () => {
    expect(incomingFromBody({ number: 'RE-1', issueDate: '2026-11-01', net: '100', tax: '19', category: 'hosting' }, [])).toMatchObject({ grossCents: 11900 })
    expect(incomingFromBody({ number: 'RE-1', issueDate: '2026-11-01', net: '100', category: 'x' }, [])).toBe('Bitte eine Kategorie wählen.')
    const time = { workDate: '2026-11-26', customerId: '3', description: 'Arbeit', quantity: '1,5', unit: 'HUR', price: '90', vatRate: 0 }
    expect(timeFromBody(time, { customers: [3], projects: [], orders: [] }, true)).toMatchObject({ quantityMilli: 1500, unitPriceCents: 9000 })
    expect(timeFromBody(time, { customers: [], projects: [], orders: [] }, true)).toBe('Bitte einen Kunden wählen.')
  })
})

describe('files', () => {
  it('recognizes uploads by their first bytes', () => {
    expect(logoType(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]))).toBe('image/png')
    expect(logoType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg')
    expect(logoType(Buffer.from('<svg/>'))).toBeNull()
    expect(incomingType(Buffer.from('%PDF-1.7'))).toBe('application/pdf')
    expect(incomingType(Buffer.from('﻿<?xml version="1.0"?><x/>'))).toBe('application/xml')
    expect(incomingType(Buffer.from('MZ'))).toBeNull()
  })

  it('turns a plain SVG logo into a sharp PNG and refuses active content', () => {
    const svg = '<?xml version="1.0"?><!-- Inkscape --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 50">'
      + '<defs><linearGradient id="g"><stop offset="0" stop-color="#06c"/></linearGradient></defs><rect width="200" height="50" fill="url(#g)"/></svg>'
    expect(isSvg(Buffer.from(svg))).toBe(true)
    expect(isSvg(Buffer.from('<html><svg></svg></html>'))).toBe(false)
    const result = svgToPng(svg)
    if (typeof result === 'string') throw new Error(result)
    expect(logoType(result.png)).toBe('image/png')
    // 70 x 25 mm at 600 dpi is 1654 x 591 px; a 4:1 logo is limited by the width.
    expect([result.png.readUInt32BE(16), result.png.readUInt32BE(20)]).toEqual([1654, 414])
    expect(result.hasText).toBe(false)

    const open = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`
    expect(svgProblem(open('<script>alert(1)</script>'))).toContain('Skripte')
    expect(svgProblem(open('<rect onload="alert(1)"/>'))).toContain('Skripte')
    expect(svgProblem(open('<foreignObject><div/></foreignObject>'))).toContain('Skripte')
    expect(svgProblem(open('<image href="https://example.org/x.png"/>'))).toContain('verweist')
    expect(svgProblem(open('<image xlink:href="/etc/passwd"/>'))).toContain('verweist')
    expect(svgProblem(open('<image href="&#104;ttps://example.org/x.png"/>'))).toContain('verweist')
    expect(svgProblem(open('<rect style="fill:url(https://example.org/a.svg#x)"/>'))).toContain('verweist')
    expect(svgProblem(open('<style>@import "https://example.org/a.css";</style>'))).toContain('Stylesheets')
    expect(svgProblem('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + open('<text>&x;</text>'))).toContain('DOCTYPE')
    expect(svgProblem(open('<image href="data:image/png;base64,iVBORw0KGgo="/><use href="#a"/>'))).toBeNull()
    expect(svgToPng('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')).toBe('Das SVG kann nicht gelesen werden.')
  })

  it('writes ZIP files that unzip reads', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xCBF43926)
    const dir = mkdtempSync(join(tmpdir(), 'erp-zip-'))
    const file = join(dir, 'test.zip')
    writeFileSync(file, zip([{ name: 'a.txt', content: Buffer.from('hallo') }, { name: 'Ordner/Über.csv', content: Buffer.from('x;y') }]))
    const listing = execFileSync('unzip', ['-l', file]).toString()
    expect(listing).toContain('Ordner/Über.csv')
    expect(execFileSync('unzip', ['-p', file, 'a.txt']).toString()).toBe('hallo')
  })

  it('builds MIME messages with attachments and refuses header injection', () => {
    const message = mimeMessage({ from: 'Firma <rechnung@example.org>', to: 'kunde@example.org', subject: 'Rechnung R-2026-0001 – Firma', text: 'Hallo', attachments: [{ filename: 'R-2026-0001.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }] }, new Date('2026-11-26T12:00:00Z'))
    expect(message).toContain('Subject: =?UTF-8?B?')
    expect(message).toContain('Content-Disposition: attachment; filename="R-2026-0001.pdf"')
    expect(message).toContain(Buffer.from('%PDF').toString('base64'))
    expect(message).toMatch(/Message-ID: <[0-9a-f]{32}@example\.org>/)
    expect(() => mimeMessage({ from: 'a@example.org', to: 'b@example.org\r\nBcc: x@example.org', subject: 's', text: '', attachments: [] })).toThrow()
  })
})

describe('dunning', () => {
  const settings = { name: 'Steuten IT Solutions', contactName: null, iban: 'DE89370400440532013000' } as CompanySettings
  const invoice = {
    status: 'final', type: '380', state: 'overdue', number: 'R-2026-0001', issueDate: '2026-10-01', dueDate: '2026-10-15',
    grossCents: 10000, paidCents: 2500, reminderLevel: 0, reminders: [],
  } as unknown as InvoiceDetail

  it('escalates from a friendly reminder to the second dunning letter', () => {
    const first = nextReminder(invoice, settings, '2026-11-01')
    expect(first).toMatchObject({ level: 1, title: 'Zahlungserinnerung', openCents: 7500, newDueDate: '2026-11-11' })
    expect(first.subject).toBe('Zahlungserinnerung: Rechnung R-2026-0001 – Steuten IT Solutions')
    const reminded = { ...invoice, reminderLevel: 2, reminders: [{ id: 1, level: 2, sentOn: '2026-11-01', newDueDate: '2026-11-11', recipient: 'x' }] }
    expect(() => nextReminder(reminded, settings, '2026-11-11')).toThrow('läuft noch bis 11.11.2026')
    expect(nextReminder(reminded, settings, '2026-11-12').title).toBe('2. Mahnung')
    expect(() => nextReminder({ ...reminded, reminderLevel: 3 }, settings, '2026-11-20')).toThrow('gerichtliches Mahnverfahren')
    expect(() => nextReminder({ ...invoice, state: 'paid' }, settings, '2026-11-01')).toThrow('bezahlt')
  })
})
