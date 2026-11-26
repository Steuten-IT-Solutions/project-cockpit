// What the pages need to know about the visitor: who is logged in, the CSRF token
// for requests that change something, and a one-time message.
export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const state = await sessionState(event)
  await commitSession(event)
  return { ...state, flash: session.takeFlash() ?? null }
})
