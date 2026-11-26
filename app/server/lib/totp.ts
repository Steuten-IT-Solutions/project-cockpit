import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238) with HMAC-SHA1, 6 digits and 30-second
 * steps, the same as src/Auth/Totp.php, so existing enrolments keep working.
 */
export const PERIOD = 30
export const DIGITS = 6
const WINDOW = 1
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) {
      throw new Error('Invalid base32 character.')
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[19]! & 0x0f
  const binary = ((hmac[offset]! & 0x7f) << 24)
    | (hmac[offset + 1]! << 16)
    | (hmac[offset + 2]! << 8)
    | hmac[offset + 3]!
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Returns the matched time step, or null. A step at or below lastUsedStep is
 * rejected, so a code cannot be replayed. Every candidate is checked, so the
 * duration does not reveal which one matched.
 */
export function verify(secret: string, code: string, timestamp: number, lastUsedStep: number | null): number | null {
  const clean = code.replace(/\s+/g, '')
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(clean)) {
    return null
  }
  const current = Math.floor(timestamp / PERIOD)
  let matched: number | null = null
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    const equal = timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(clean))
    if (equal && (lastUsedStep === null || step > lastUsedStep)) {
      matched ??= step
    }
  }
  return matched
}
