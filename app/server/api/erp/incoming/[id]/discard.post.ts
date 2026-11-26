import { cleanText } from '#shared/lib/erp'
import { IncomingRepository } from '../../../../lib/erp/incoming'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const reason = cleanText((await readObject(event)).reason, 255)
  if (reason === null) refuse('Bitte einen Grund angeben, z. B. „doppelt erfasst“ oder „keine Rechnung“.')
  if (!await new IncomingRepository(erp.pool).discard(idParam(event), reason, erp.now())) refuse('Bereits verworfen.')
  return { message: 'Verworfen. Die Datei bleibt aufbewahrt.' }
})
