import { logoType } from '../../lib/erp/files'

// Upload of the logo (PNG or JPEG, at most 1 MB), as multipart form field "logo".
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const file = (await readMultipartFormData(event))?.find(part => part.name === 'logo')
  if (file === undefined || file.data.length === 0) refuse('Bitte eine Bilddatei wählen.')
  if (file.data.length > 1_000_000) refuse('Das Logo darf höchstens 1 MB groß sein.')
  const type = logoType(file.data)
  if (type === null) refuse('Das Logo muss ein PNG- oder JPEG-Bild sein.')
  if (!await erp.master.setLogo({ data: file.data, type }, erp.now())) refuse('Bitte speichere zuerst die Firmendaten.')
  return { message: 'Logo gespeichert.' }
})
