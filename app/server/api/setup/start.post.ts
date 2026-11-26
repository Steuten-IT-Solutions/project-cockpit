import QRCode from 'qrcode'
import { hashPassword } from '../../lib/password'
import { accountError, generateTotpSecret, provisioningUri } from '../../lib/setup'

// Step 1: name and password; answers with the QR code for the authenticator app.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  await requireSetup(event, body?.token)
  const username = bodyString(body, 'username').trim()
  const password = bodyString(body, 'password')
  const error = accountError(username, password, bodyString(body, 'passwordConfirm'))
  if (error !== null) {
    throw createError({ statusCode: 422, statusMessage: error })
  }
  const secret = generateTotpSecret()
  const { crypto } = useCockpit(event)
  const session = requireSession(event)
  const passwordHash = await hashPassword(password)
  session.update((data) => {
    data.setup = { username, passwordHash, secretEnc: crypto.encrypt(secret) }
  })
  await commitSession(event)
  return {
    qr: await QRCode.toDataURL(provisioningUri(secret, username), { errorCorrectionLevel: 'M', margin: 2, width: 220 }),
    secret: secret.replace(/(.{4})(?=.)/g, '$1 '),
  }
})
