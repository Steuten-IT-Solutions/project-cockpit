import { normaliseRecoveryCode } from '../../lib/recovery'
import { verify } from '../../lib/totp'

// Second step of the login: a TOTP code from the authenticator app or a single-use
// recovery code.
export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const user = await pendingUser(event)
  if (user === null) {
    session.update(data => (data.flash = 'Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.'))
    await commitSession(event)
    throw createError({ statusCode: 409, statusMessage: 'Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.' })
  }

  const ip = clientIp(event)
  const { crypto, users, throttle, log } = useCockpit(event)

  if (await throttle.isBlocked(user.username, ip)) {
    await log.record('login_throttled', user.id, ip)
    throw createError({ statusCode: 429, statusMessage: 'Zu viele Fehlversuche. Bitte warte 15 Minuten.' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const input = typeof body?.code === 'string' ? body.code.trim() : ''
  let ok = false
  let usedRecovery = false

  if (/^\d{3}\s?\d{3}$/.test(input)) {
    const step = verify(crypto.decrypt(user.totpSecretEnc), input, Math.floor(Date.now() / 1000), user.totpLastStep)
    ok = step !== null && await users.claimTotpStep(user.id, step)
  }
  else if (input !== '') {
    ok = usedRecovery = await users.useRecoveryCode(user.id, crypto.hash('recovery', normaliseRecoveryCode(input)))
  }

  if (!ok) {
    await throttle.recordFailure(user.username, ip)
    await log.record('code_failed', user.id, ip)
    throw createError({ statusCode: 401, statusMessage: 'Der Code ist ungültig oder wurde schon verwendet.' })
  }

  await throttle.clearAccount(user.username)
  session.update((data) => {
    delete data.pendingUser
    delete data.pendingAt
  })
  session.setUser(user.id)
  await session.regenerate()
  await users.touchLogin(user.id)
  await log.record(usedRecovery ? 'login_recovery' : 'login', user.id, ip)

  if (usedRecovery) {
    const left = await users.remainingRecoveryCodes(user.id)
    session.update(data => (data.flash = `Du hast einen Wiederherstellungscode verwendet. Es sind noch ${left} übrig.`))
  }
  await commitSession(event)
  return { next: '/' }
})
