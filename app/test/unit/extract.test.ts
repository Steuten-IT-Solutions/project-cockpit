import { describe, expect, it } from 'vitest'
import { amountCents, dateIso, extractFields } from '../../server/lib/erp/extract'

const OWN = { iban: 'DE89370400440532013000', vatId: 'DE463748776' }
const SUPPLIERS = [
  { id: 1, name: 'Hetzner Online GmbH', vatId: 'DE812871812', iban: null },
  { id: 2, name: 'Strato AG', vatId: null, iban: 'DE02120300000000202051' },
]

// Text as pdftotext -layout prints a typical German invoice.
const INVOICE = `
Muster Software GmbH · Hauptstraße 5 · 10115 Berlin
Steuten IT Solutions
Musterweg 1                                         Rechnungsnummer:      RE-2026/0815
48143 Münster                                       Rechnungsdatum:       20.11.2026
                                                    Leistungsdatum:       15.11.2026
                                                    Ihre USt-IdNr.:       DE 463 748 776
Rechnung

Pos.  Bezeichnung                Menge   Einzelpreis      Gesamt
1     Lizenz Jahresabo           1       100,00 €         100,00 €
2     Support                    2,5     40,00 €          100,00 €

                                         Summe netto       200,00 €
                                         zzgl. 19 % MwSt.   38,00 €
                                         Gesamtbetrag      238,00 €

Zahlbar innerhalb von 14 Tagen ohne Abzug.
IBAN: DE02 1203 0000 0000 2020 51   BIC: BYLADEM1001
USt-IdNr.: DE123456789
`

describe('reading incoming invoices without e-invoice data', () => {
  it('reads amounts and dates in German and English style', () => {
    expect(amountCents('1.234,56')).toBe(123456)
    expect(amountCents('1,234.56')).toBe(123456)
    expect(amountCents('38,00')).toBe(3800)
    expect(amountCents('1.234.56')).toBeNull()
    expect(dateIso('20.11.2026')).toBe('2026-11-20')
    expect(dateIso('20.11.26')).toBe('2026-11-20')
    expect(dateIso('2026-11-20')).toBe('2026-11-20')
    expect(dateIso('3. Dezember 2026')).toBe('2026-12-03')
    expect(dateIso('31.02.2026')).toBeNull()
  })

  it('fills the fields of a typical invoice', () => {
    expect(extractFields(INVOICE, SUPPLIERS, OWN)).toEqual({
      number: 'RE-2026/0815', issueDate: '2026-11-20', dueDate: '2026-12-04',
      netCents: 20000, taxCents: 3800, grossCents: 23800,
      // The own IBAN and VAT id (buyer) are skipped; the supplier is known by its IBAN.
      iban: 'DE02120300000000202051', vatId: 'DE123456789', supplierId: 2,
    })
  })

  it('adds up two tax rates and leaves out what does not add up', () => {
    const two = `Rechnung Nr. 4711\nDatum: 01.12.2026\nNetto 150,00\nUSt 19 % 19,00\nUSt 7 % 3,50\nGesamtbetrag 172,50\nfällig am 15.12.2026`
    expect(extractFields(two, SUPPLIERS, OWN)).toMatchObject({ number: '4711', netCents: 15000, taxCents: 2250, grossCents: 17250, dueDate: '2026-12-15' })
    const wrong = `Rechnungsnummer 12\nNetto 100,00\nMwSt 10,00\nGesamtbetrag 150,00`
    expect(extractFields(wrong, [], OWN)).toMatchObject({ netCents: null, taxCents: null, grossCents: 15000 })
  })

  it('takes a small business invoice as net without tax', () => {
    const small = `Rechnungsnr.: 2026-07\nRechnungsdatum 05.11.2026\nGesamtbetrag: 80,00 €\nGemäß § 19 UStG wird keine Umsatzsteuer berechnet.`
    expect(extractFields(small, [], OWN)).toMatchObject({ number: '2026-07', netCents: 8000, taxCents: 0, grossCents: 8000 })
  })

  it('does not take a word for the number or a rate for an amount', () => {
    const text = `Rechnung vom 03.11.2026\nRechnungsnummer: siehe unten\nHetzner Online GmbH\nSumme 19,00 %\nTotal 12,34`
    expect(extractFields(text, SUPPLIERS, OWN)).toMatchObject({ number: null, issueDate: '2026-11-03', grossCents: 1234, supplierId: 1 })
    expect(extractFields('', SUPPLIERS, OWN)).toEqual({
      number: null, issueDate: null, dueDate: null, netCents: null, taxCents: null, grossCents: null, iban: null, vatId: null, supplierId: null,
    })
  })
})
