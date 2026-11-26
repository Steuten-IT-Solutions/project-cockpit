// The logo printed on documents, for the preview on the settings page.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const logo = await useErp(event).master.logo()
  if (logo === null) throw createError({ statusCode: 404, statusMessage: 'Kein Logo' })
  return sendFile(event, logo.data, logo.type === 'image/png' ? 'logo.png' : 'logo.jpg', logo.type, true)
})
