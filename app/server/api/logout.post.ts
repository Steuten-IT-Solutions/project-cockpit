export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  if (session.userId !== null) {
    await useCockpit(event).log.record('logout', session.userId, clientIp(event))
  }
  await session.destroy()
  deleteCookie(event, sessionCookieName(event), { path: '/' })
  return { next: '/login' }
})
