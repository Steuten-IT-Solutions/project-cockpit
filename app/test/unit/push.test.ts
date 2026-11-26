import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validEndpoint, WebPush } from '../../server/lib/push'

// A throwaway key made for this test only. Expected values come from src/Notify/WebPush.php.
const PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIJS6hVAi86FlPzlTUNJWnTNi2N9FksR/OcmKmUgWLoi7oAoGCCqGSM49
AwEHoUQDQgAED55hj+lEWvH+HKkPi+6tW6R1pPNGIE3XFkFn94xXCke5Z7L2eWNX
YeIp6fQjwwBZnqe9nb8/FtDPZKDok7hciw==
-----END EC PRIVATE KEY-----`
const PHP_PUBLIC = 'BA-eYY_pRFrx_hypD4vurVukdaTzRiBN1xZBZ_eMVwpHuWey9nljV2HiKen0I8MAWZ6nvZ2_PxbQz2Sg6JO4XIs'
const PHP_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL2ZjbS5nb29nbGVhcGlzLmNvbSIsImV4cCI6MTcwMDA0MzIwMCwic3ViIjoibWFpbHRvOmFAYi5kZSJ9.C0tYMu11Y90V9PXilcLe_F0T__yZyzHMbBNLu6QzlO4x5xOjN_j1wMJENMp88H6YqhIObrBflJqDGtwlMeVQyA'

function valid(token: string): boolean {
  const [header, claims, signature] = token.split('.')
  return verify('sha256', Buffer.from(`${header}.${claims}`), { key: createPublicKey(PEM), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))
}

describe('web push', () => {
  it('derives the same public key as the PHP cockpit, so subscriptions stay valid', () => {
    expect(new WebPush(PEM, 'mailto:a@b.de').publicKey).toBe(PHP_PUBLIC)
  })

  it('writes the same VAPID claims and a valid ES256 signature', () => {
    const token = new WebPush(PEM, 'mailto:a@b.de').token('https://fcm.googleapis.com', 1700000000)
    expect(token.split('.').slice(0, 2)).toEqual(PHP_TOKEN.split('.').slice(0, 2))
    expect(valid(token)).toBe(true)
    // The check itself works: the PHP token verifies, a changed one does not.
    expect(valid(PHP_TOKEN)).toBe(true)
    expect(valid(PHP_TOKEN.replace('.C0t', '.C1t'))).toBe(false)
  })

  it('posts an empty message with VAPID headers', async () => {
    const calls: [string, Record<string, string>][] = []
    const push = new WebPush(PEM, 'mailto:a@b.de', async (endpoint, headers) => {
      calls.push([endpoint, headers])
      return 201
    })
    expect(await push.send('https://fcm.googleapis.com/fcm/send/abc', 1700000000)).toBe(201)
    expect(calls[0]![1].Authorization).toMatch(/^vapid t=.+, k=BA-e/)
    expect(calls[0]![1]['Content-Length']).toBe('0')
    await expect(push.send('https://evil.example.org/x', 1)).rejects.toThrow()
  })

  it('accepts only the known push services', () => {
    expect(validEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true)
    expect(validEndpoint('https://web.push.apple.com/abc')).toBe(true)
    expect(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(validEndpoint('http://fcm.googleapis.com/x')).toBe(false)
    expect(validEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(validEndpoint('https://user@fcm.googleapis.com/x')).toBe(false)
    expect(validEndpoint('https://fcm.googleapis.com.evil.org/x')).toBe(false)
    expect(() => new WebPush('not a key', 'mailto:a@b.de')).toThrow('EC P-256')
  })
})
