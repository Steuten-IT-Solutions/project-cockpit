import { randomBytes, randomInt } from 'node:crypto'

// The first account (src/App.php setup*, src/Auth/Totp.php, RecoveryCodes.php): only while a
// setup token is configured and no user exists. After the cutover the existing account is
// used; this is for a fresh installation.

export const ISSUER = 'Steuten IT Cockpit'
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
/** Unambiguous alphabet: no 0/O, 1/I/L. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** 160 bits, the shared-secret length RFC 4226 recommends. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** RFC 3986 encoding like PHP's rawurlencode(). */
function rawurlencode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function provisioningUri(secret: string, account: string, issuer = ISSUER): string {
  const query = [['secret', secret], ['issuer', issuer], ['algorithm', 'SHA1'], ['digits', '6'], ['period', '30']]
    .map(([k, v]) => `${k}=${rawurlencode(v!)}`).join('&')
  return `otpauth://totp/${rawurlencode(issuer)}:${rawurlencode(account)}?${query}`
}

/** Ten codes formatted as XXXXX-XXXXX (about 49 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
}

/** The German error message for the first form, or null. */
export function accountError(username: string, password: string, confirm: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) return 'Der Benutzername muss 3–64 Zeichen lang sein (Buchstaben, Ziffern, . _ -).'
  if ([...password].length < 12) return 'Das Passwort muss mindestens 12 Zeichen lang sein.'
  if (password !== confirm) return 'Die Passwörter stimmen nicht überein.'
  return null
}
