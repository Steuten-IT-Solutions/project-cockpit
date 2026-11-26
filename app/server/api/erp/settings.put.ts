import { settingsFromBody } from '../../lib/erp/forms'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const settings = settingsFromBody(await readObject(event))
  if (typeof settings === 'string') refuse(settings)
  await erp.master.saveSettings(settings, erp.now())
  return { message: 'Firmendaten gespeichert.' }
})
