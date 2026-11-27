import { logoType } from '../../lib/erp/files'
import { isSvg, svgToPng } from '../../lib/erp/logo'

// Upload of the logo (PNG, JPEG or SVG, at most 1 MB), as multipart form field "logo".
// An SVG is checked and stored as a PNG (server/lib/erp/logo.ts).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const file = (await readMultipartFormData(event))?.find(part => part.name === 'logo')
  if (file === undefined || file.data.length === 0) refuse('Bitte eine Bilddatei wählen.')
  if (file.data.length > 1_000_000) refuse('Das Logo darf höchstens 1 MB groß sein.')
  let logo: { data: Buffer, type: string }
  let message = 'Logo gespeichert.'
  const type = logoType(file.data)
  if (type !== null) {
    logo = { data: file.data, type }
  }
  else if (isSvg(file.data)) {
    const result = svgToPng(file.data.toString('utf8'))
    if (typeof result === 'string') refuse(result)
    logo = { data: result.png, type: 'image/png' }
    if (result.hasText) message = 'Logo gespeichert. Es enthält Schrift: Prüfe die Vorschau. Sieht sie anders aus, wandle die Schrift in deinem Grafikprogramm in Pfade um.'
  }
  else {
    refuse('Das Logo muss ein PNG-, JPEG- oder SVG-Bild sein.')
  }
  if (!await erp.master.setLogo(logo, erp.now())) refuse('Bitte speichere zuerst die Firmendaten.')
  return { message }
})
