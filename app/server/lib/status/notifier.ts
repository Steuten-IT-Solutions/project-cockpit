import { spawn } from 'node:child_process'
import type { Alert } from '#shared/types/cockpit'
import { companyName, variantLabel } from '#shared/lib/status'
import type { WebPush } from '../push'
import type { PushSubscriptionRepository } from '../repositories/push'

// Sends alert messages (src/Status/Notifier.php): one e-mail per run with all new alerts
// and all-clears, and a web push without payload to every subscribed device.

/** Subject and plain-text body (German). */
export function alertMessage(alerts: Alert[], baseUrl: string): [string, string] {
  const fresh = alerts.filter(a => a.resolvedAt === null || a.notifiedAt === null)
  const resolved = alerts.filter(a => a.resolvedAt !== null)
  const parts: string[] = []
  if (fresh.length > 0) parts.push(fresh.length === 1 ? '1 Warnung' : `${fresh.length} Warnungen`)
  if (resolved.length > 0) parts.push(resolved.length === 1 ? '1 Entwarnung' : `${resolved.length} Entwarnungen`)
  const lines: string[] = []
  for (const [title, list] of [['Neue Warnungen', fresh], ['Entwarnung (Problem behoben)', resolved]] as const) {
    if (list.length === 0) continue
    lines.push(`${title}:`)
    for (const a of list) {
      const who = a.kompanie === '*' ? 'Alle Kompanien' : companyName(a.kompanie) + (a.variant !== null ? ` (${variantLabel(a.variant)})` : '')
      lines.push(`- ${who}: ${a.detail}`)
      if (a.installationId !== null) lines.push(`  ${baseUrl}/installation?id=${a.installationId}`)
    }
    lines.push('')
  }
  lines.push(`Alle Warnungen: ${baseUrl}/alerts`)
  return [`Cockpit: ${parts.join(', ')}`, `${lines.join('\n')}\n`]
}

/** RFC 2047 encoded header value (base64) unless it is plain ASCII. */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** The bare address of "Name <address>" or "address". */
export function bareAddress(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from
}

/** to, from, subject, body → delivered. Production pipes the message into the server's sendmail (Postfix). */
export type Mailer = (to: string, from: string, subject: string, body: string) => Promise<boolean>

export function sendmail(binary: string): Mailer {
  return (to, from, subject, body) => new Promise((resolve) => {
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
    ].join('\r\n')
    // -i: a line with a single dot does not end the message; -f: envelope sender for bounces.
    const child = spawn(binary, ['-i', '-f', bareAddress(from), '--', to], { stdio: ['pipe', 'ignore', 'pipe'] })
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
    child.stdin.end(message)
  })
}

export class Notifier {
  constructor(
    private readonly baseUrl: string,
    private readonly email: { to: string, from: string } | null,
    private readonly push: WebPush | null,
    private readonly subscriptions: PushSubscriptionRepository | null,
    private readonly mail: Mailer,
  ) {}

  /** Returns whether at least one channel delivered. */
  async send(alerts: Alert[], now: number): Promise<boolean> {
    if (alerts.length === 0) return false
    const [subject, body] = alertMessage(alerts, this.baseUrl)
    let delivered = false
    if (this.email !== null) {
      try {
        delivered = await this.mail(this.email.to, this.email.from, subject, body)
      }
      catch (e) {
        console.error('[cockpit alerts] mail:', (e as Error).message)
      }
    }
    if (this.push !== null && this.subscriptions !== null) {
      for (const sub of await this.subscriptions.all()) {
        try {
          const status = await this.push.send(sub.endpoint, now)
          // 404/410: subscription gone. 403 from FCM: made with another VAPID key (the device subscribes
          // again on its next visit). Other services answer 403 for a bad token: keep it and show the error.
          if (status === 404 || status === 410 || (status === 403 && sub.endpoint.startsWith('https://fcm.googleapis.com/'))) {
            await this.subscriptions.remove(sub.endpoint)
          }
          else if (status >= 200 && status < 300) {
            delivered = true
          }
          else {
            await this.subscriptions.markError(sub.endpoint, `HTTP ${status}`)
          }
        }
        catch (e) {
          await this.subscriptions.markError(sub.endpoint, (e as Error).message)
        }
      }
    }
    return delivered
  }
}
