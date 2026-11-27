import { dummyHash, hashPassword, needsRehash, verifyPassword } from '../lib/password'

// First step of the login: username and password. On success the session remembers
// the user as "pending" until the second factor is entered on /login/code.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const ip = clientIp(event)
  const { users, throttle, log } = useCockpit(event)
  const session = requireSession(event)

  // One attempt at a time, so parallel requests cannot slip past the failure count.
  const user = await loginQueue.run(async () => {
    if (await throttle.isBlocked(username, ip)) {
      await log.record('login_throttled', null, ip)
      throw createError({ statusCode: 429, statusMessage: 'Zu viele Fehlversuche. Bitte warte 15 Minuten.' })
    }

    const found = username === '' ? null : await users.findByUsername(username)
    // Verify against a dummy hash for unknown users so the timing does not reveal them.
    const hash = found?.passwordHash ?? await dummyHash()
    const valid = await verifyPassword(hash, password)

    if (!valid || found === null) {
      await throttle.recordFailure(username, ip)
      await log.record('login_failed', found?.id ?? null, ip)
      throw createError({ statusCode: 401, statusMessage: 'Benutzername oder Passwort ist falsch.' })
    }
    return found
  })

  if (needsRehash(user.passwordHash)) {
    await users.updatePasswordHash(user.id, await hashPassword(password))
  }

  session.update((data) => {
    data.pendingUser = user.id
    data.pendingAt = Math.floor(Date.now() / 1000)
  })
  await session.regenerate()
  await commitSession(event)
  return { next: '/login/code' }
})
