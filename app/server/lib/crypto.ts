import { createHash, createHmac, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'

const KEY_BYTES = nacl.secretbox.keyLength // 32
const NONCE_BYTES = nacl.secretbox.nonceLength // 24
const MIN_PASSPHRASE_LENGTH = 40

/**
 * Turns the configured app key into the 32-byte key, exactly like the PHP
 * cockpit (src/Config.php::appKey): either 32 random bytes, base64-encoded, or a
 * random passphrase of at least 40 characters, hashed with SHA-256.
 */
export function deriveAppKey(value: string): Uint8Array {
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === KEY_BYTES && decoded.toString('base64') === value) {
      return new Uint8Array(decoded)
    }
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The app key must be 32 random bytes, base64-encoded, or a random passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  }
  return new Uint8Array(createHash('sha256').update(`project-cockpit app_key v1\0${value}`, 'utf8').digest())
}

/**
 * Secret-key encryption and keyed hashes, compatible with src/Security/Crypto.php:
 * libsodium's crypto_secretbox (XSalsa20-Poly1305) with the nonce in front,
 * base64-encoded, and HMAC-SHA256 over "purpose \0 value".
 */
export class Crypto {
  constructor(private readonly key: Uint8Array) {
    if (key.length !== KEY_BYTES) {
      throw new Error('The key must be 32 bytes long.')
    }
  }

  encrypt(plaintext: string): string {
    const nonce = new Uint8Array(randomBytes(NONCE_BYTES))
    const box = nacl.secretbox(new Uint8Array(Buffer.from(plaintext, 'utf8')), nonce, this.key)
    return Buffer.concat([nonce, box]).toString('base64')
  }

  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, 'base64')
    if (raw.length <= NONCE_BYTES || raw.toString('base64') !== encoded) {
      throw new Error('Ciphertext is malformed.')
    }
    const plaintext = nacl.secretbox.open(
      new Uint8Array(raw.subarray(NONCE_BYTES)),
      new Uint8Array(raw.subarray(0, NONCE_BYTES)),
      this.key,
    )
    if (plaintext === null) {
      throw new Error('Ciphertext could not be authenticated.')
    }
    return Buffer.from(plaintext).toString('utf8')
  }

  /** Keyed hash for values that must be comparable but not reversible (IPs, recovery codes). */
  hash(purpose: string, value: string): string {
    return createHmac('sha256', this.key).update(`${purpose}\0${value}`, 'utf8').digest('hex')
  }
}
