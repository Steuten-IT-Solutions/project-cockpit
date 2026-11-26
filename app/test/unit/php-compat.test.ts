import { describe, expect, it } from 'vitest'
import { Crypto, deriveAppKey } from '../../server/lib/crypto'
import { needsRehash, verifyPassword } from '../../server/lib/password'
import { normaliseRecoveryCode } from '../../server/lib/recovery'
import { codeAt, verify } from '../../server/lib/totp'

// Fixtures written by the PHP cockpit (src/Security/Crypto.php, src/Auth/Totp.php,
// password_hash). The new cockpit must read everything the old one stored.
const PASSPHRASE = 'local-development-key-that-is-long-enough-123456'
const PHP = {
  key: 'PGxXXzWYPQGxjJvaxcsre4w/udHuB/ZmjSgofMm64Us=',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  encryptedSecret: 'okHq7SOoSLvGsMemzxvB8sE+xEag49U62v3CeT9MAo+KelvoDRMGal/vT0oDhLH+Ql4MrZUmiK0OOOcc5KuAWIltsfW1Cqbk',
  recoveryHash: '8b7a648261c9dba1b5527789a3e9e8f9ab18b165fd0d784ab57a6e260703c8b2',
  argon2id: '$argon2id$v=19$m=65536,t=4,p=1$LjcyNG12QjdjcEZxZFlBVw$ufW0Tiw8TPE/0/rvwLcbiF7sa8I2MIOed5nskyAUqhs',
  bcrypt: '$2y$10$BRFKOiFu6sv/zu/jgi/G4O/5dHmiEEt9Ei8GJjAYiY38wzyoEzXA6',
  codeAtStep59: '073264',
}
const PASSWORD = 'correct horse battery staple'

describe('app key', () => {
  it('derives the same key from a passphrase as PHP', () => {
    expect(Buffer.from(deriveAppKey(PASSPHRASE)).toString('base64')).toBe(PHP.key)
  })

  it('accepts 32 bytes in base64 as they are', () => {
    expect(Buffer.from(deriveAppKey(PHP.key)).toString('base64')).toBe(PHP.key)
  })

  it('rejects short passphrases', () => {
    expect(() => deriveAppKey('too short')).toThrow()
  })
})

describe('crypto', () => {
  const crypto = new Crypto(deriveAppKey(PASSPHRASE))

  it('decrypts a TOTP secret encrypted by PHP', () => {
    expect(crypto.decrypt(PHP.encryptedSecret)).toBe(PHP.totpSecret)
  })

  it('round-trips its own ciphertext', () => {
    expect(crypto.decrypt(crypto.encrypt('ünïcode ✓'))).toBe('ünïcode ✓')
  })

  it('rejects tampered or malformed ciphertext', () => {
    const tampered = Buffer.from(PHP.encryptedSecret, 'base64')
    tampered[30] = tampered[30]! ^ 1
    expect(() => crypto.decrypt(tampered.toString('base64'))).toThrow()
    expect(() => crypto.decrypt('not base64!')).toThrow()
    expect(() => new Crypto(deriveAppKey(`${PASSPHRASE}x`)).decrypt(PHP.encryptedSecret)).toThrow()
  })

  it('computes the same keyed hash as PHP', () => {
    expect(crypto.hash('recovery', normaliseRecoveryCode('abcde-fghjk'))).toBe(PHP.recoveryHash)
  })
})

describe('totp', () => {
  it('computes the same code as PHP', () => {
    expect(codeAt(PHP.totpSecret, 59)).toBe(PHP.codeAtStep59)
  })

  it('matches the RFC 6238 test vector', () => {
    // Secret "12345678901234567890" in base32; the RFC gives 94287082 for T = 59 s (8 digits).
    expect(codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082')
  })

  it('accepts the current and neighbouring steps and refuses replays', () => {
    const now = 59 * 30 + 5
    expect(verify(PHP.totpSecret, PHP.codeAtStep59, now, null)).toBe(59)
    expect(verify(PHP.totpSecret, '073 264', now + 30, null)).toBe(59)
    expect(verify(PHP.totpSecret, PHP.codeAtStep59, now + 60, null)).toBeNull()
    expect(verify(PHP.totpSecret, PHP.codeAtStep59, now, 59)).toBeNull()
    expect(verify(PHP.totpSecret, '12345', now, null)).toBeNull()
  })
})

describe('passwords', () => {
  it('verifies an Argon2id hash written by PHP', async () => {
    expect(await verifyPassword(PHP.argon2id, PASSWORD)).toBe(true)
    expect(await verifyPassword(PHP.argon2id, 'wrong')).toBe(false)
    expect(needsRehash(PHP.argon2id)).toBe(false)
  })

  it('verifies a bcrypt hash written by PHP and asks for a rehash', async () => {
    expect(await verifyPassword(PHP.bcrypt, PASSWORD)).toBe(true)
    expect(await verifyPassword(PHP.bcrypt, 'wrong')).toBe(false)
    expect(needsRehash(PHP.bcrypt)).toBe(true)
  })

  it('refuses unknown hash formats', async () => {
    expect(await verifyPassword('plain', 'plain')).toBe(false)
  })
})
