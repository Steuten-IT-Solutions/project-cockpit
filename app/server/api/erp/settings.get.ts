import { DEFAULT_MAIL_TEXT } from '#shared/lib/erp'

// Company data for the settings page (null until saved once).
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { settings: await useErp(event).master.settings(), defaultMailText: DEFAULT_MAIL_TEXT }
})
