import { CURRENCIES, isoDate } from '#shared/lib/erp'
import { ecbRate } from '../../lib/erp/rates'

// The ECB reference rate of a currency on a day, for an incoming invoice in that
// currency: ?currency=USD&date=2026-11-03. Answers { rate: null } when the ECB has none.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = getQuery(event)
  const currency = String(query.currency ?? '')
  const date = isoDate(String(query.date ?? ''))
  if (!(currency in CURRENCIES) || currency === 'EUR') refuse('Unbekannte Währung.')
  if (date === null) refuse('Bitte das Rechnungsdatum angeben.')
  try {
    return { rate: await ecbRate(currency, date) }
  }
  catch (e) {
    console.error('[cockpit] ECB exchange rate:', e)
    refuse('Der Kurs der EZB ist gerade nicht abrufbar. Bitte trage ihn selbst ein.')
  }
})
