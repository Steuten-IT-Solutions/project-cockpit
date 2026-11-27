import { EngineInputError } from '../../../lib/erp/engine'
import { extractFields } from '../../../lib/erp/extract'
import { incomingType } from '../../../lib/erp/files'
import { IncomingRepository } from '../../../lib/erp/incoming'
import { invoiceText } from '../../../lib/erp/ocr'
import { ecbRate, type Rate } from '../../../lib/erp/rates'

// Suggestions for the form while entering an incoming invoice: the file (multipart
// "file") is read, nothing is stored. An e-invoice needs no suggestions; it fills itself
// on upload. For other PDFs and photos the text is read (or recognized) on the server
// and the fields found in it are returned; the user checks them before saving.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const parts = await readMultipartFormData(event) ?? []
  const file = parts.find(p => p.name === 'file' && p.filename !== undefined)
  if (file === undefined || file.data.length === 0) refuse('Bitte eine Datei wählen.')
  if (file.data.length > 7_500_000) refuse('Die Datei darf höchstens 7,5 MB groß sein.')
  const type = incomingType(file.data)
  if (type === null) refuse('Erlaubt sind E-Rechnungen (XML), PDF-Dateien und Fotos (PNG, JPEG).')

  if (type === 'application/pdf' || type === 'application/xml') {
    try {
      await erp.engine.read(file.data)
      return { einvoice: true, fields: null, source: null, problem: null, rate: null }
    }
    catch (e) {
      if (!(e instanceof EngineInputError)) throw e
    }
  }
  const { text, source, problem } = await invoiceText(file.data, type)
  const [suppliers, settings] = await Promise.all([new IncomingRepository(erp.pool).suppliers(), erp.master.settings()])
  const fields = text === '' ? null : extractFields(text, suppliers, { iban: settings?.iban ?? null, vatId: settings?.vatId ?? null })
  // Amounts in another currency: the ECB rate of the invoice date to convert them.
  let rate: Rate | null = null
  if (fields !== null && fields.currency !== 'EUR' && fields.issueDate !== null) {
    rate = await ecbRate(fields.currency, fields.issueDate).catch(() => null)
  }
  return { einvoice: false, fields, source, problem, rate }
})
