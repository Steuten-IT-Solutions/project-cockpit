// Whether the setup page may be shown (404 otherwise).
export default defineEventHandler(async (event) => {
  await requireSetup(event, getQuery(event).token)
  return { ok: true }
})
