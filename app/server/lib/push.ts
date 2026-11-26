import { createPrivateKey, type KeyObject, sign } from 'node:crypto'

// Web push without payload (RFC 8030) with VAPID (RFC 8292), like src/Notify/WebPush.php.
// The service worker (public/sw.js) shows a fixed notification and opens /alerts; the
// details stay behind the login. Without payload nothing needs encrypting, only the
// VAPID token (an ES256 JWT) is needed. The key is the same vapid.pem as before, so
// devices that subscribed with the PHP cockpit keep working.

/** Seconds a push service keeps an undelivered message. */
const TTL = 86400

/** Hosts of the push services of Chrome/Android, Firefox, Safari/iOS and Edge/Windows. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]

export function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

/** Only https endpoints of the known push services: the cockpit never posts anywhere else. */
export function validEndpoint(endpoint: string): boolean {
  if (endpoint.length > 500) return false
  let url: URL
  try {
    url = new URL(endpoint)
  }
  catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS.some(p => p.test(host))
}

export type Transport = (endpoint: string, headers: Record<string, string>) => Promise<number>

const fetchTransport: Transport = async (endpoint, headers) => {
  const response = await fetch(endpoint, { method: 'POST', headers, body: '', redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  return response.status
}

export class WebPush {
  private readonly key: KeyObject
  /** Public key (uncompressed point, base64url) for pushManager.subscribe() in the browser. */
  readonly publicKey: string

  constructor(pem: string, private readonly subject: string, private readonly transport: Transport = fetchTransport) {
    let key: KeyObject
    try {
      key = createPrivateKey(pem)
    }
    catch {
      throw new Error('The VAPID key must be an EC P-256 private key in PEM.')
    }
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('The VAPID key must be an EC P-256 private key in PEM.')
    }
    this.key = key
    const jwk = key.export({ format: 'jwk' })
    this.publicKey = base64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]))
  }

  /** VAPID JWT (ES256), valid for 12 hours. */
  token(audience: string, now: number): string {
    const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
    const claims = base64url(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: this.subject }))
    const input = `${header}.${claims}`
    // ieee-p1363 gives the raw r||s form JWS needs (PHP converted it from DER by hand).
    const signature = sign('sha256', Buffer.from(input), { key: this.key, dsaEncoding: 'ieee-p1363' })
    return `${input}.${base64url(signature)}`
  }

  /** Sends one push. Returns the HTTP status: 201 delivered; 404 and 410 mean the subscription is gone. */
  async send(endpoint: string, now: number): Promise<number> {
    if (!validEndpoint(endpoint)) {
      throw new Error('Invalid push endpoint.')
    }
    const audience = `https://${new URL(endpoint).hostname}`
    return this.transport(endpoint, {
      'TTL': String(TTL),
      'Urgency': 'high',
      'Authorization': `vapid t=${this.token(audience, now)}, k=${this.publicKey}`,
      'Content-Length': '0',
    })
  }
}
