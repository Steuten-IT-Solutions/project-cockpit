import { normaliseRecoveryCode } from '../../lib/recovery'
import { generateRecoveryCodes } from '../../lib/setup'
import { verify } from '../../lib/totp'

// Step 2: the first code from the app; creates the account and shows the recovery codes once.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  await requireSetup(event, body?.token)
  const session = requireSession(event)
  const pending = session.data.setup
  if (pending === undefined) {
    throw createError({ statusCode: 409, statusMessage: 'Die Einrichtung ist abgelaufen. Bitte beginne neu.' })
  }
  const { crypto, users, log } = useCockpit(event)
  const secret = crypto.decrypt(pending.secretEnc)
  const step = verify(secret, bodyString(body, 'code'), Math.floor(Date.now() / 1000), null)
  if (step === null) {
    throw createError({ statusCode: 422, statusMessage: 'Der Code passt nicht. Prüfe die Uhrzeit des Handys und versuche den nächsten Code.' })
  }
  const codes = generateRecoveryCodes()
  const userId = await users.create(pending.username, pending.passwordHash, crypto.encrypt(secret), step,
    codes.map(c => crypto.hash('recovery', normaliseRecoveryCode(c))))
  session.update((data) => {
    delete data.setup
  })
  await commitSession(event)
  await log.record('setup', userId, clientIp(event))
  return { codes }
})
