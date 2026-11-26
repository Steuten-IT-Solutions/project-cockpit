import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import bcrypt from 'bcryptjs'

// PHP's PASSWORD_ARGON2ID defaults, so hashes look the same as those of the PHP cockpit.
// algorithm 2 = Argon2id (a const enum in @node-rs/argon2, so written as its value).
const OPTIONS: Parameters<typeof argon2Hash>[1] = { algorithm: 2, memoryCost: 65536, timeCost: 4, parallelism: 1 }

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, OPTIONS)
}

/**
 * Verifies a hash written by PHP's password_hash(): Argon2id normally, bcrypt
 * ($2y$) if the old host's PHP had no Argon2 support.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    return argon2Verify(hash, password)
  }
  if (/^\$2[aby]\$/.test(hash)) {
    return bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2b$'))
  }
  return false
}

/** true when the hash should be replaced by a fresh Argon2id hash after a successful login. */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith('$argon2id$v=19$m=65536,t=4,p=1$')
}

let dummy: Promise<string> | undefined

/** A hash to verify against for unknown users, so the timing does not reveal them. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('dummy-password')
  return dummy
}
