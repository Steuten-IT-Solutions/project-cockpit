import type { OutgoingMail } from '../erp/mail'

// The contact form of the company website (website/ in the repository, served by Apache on
// www). The page is static HTML without scripts, so the form is a plain POST; Apache forwards
// it to server/routes/_website/kontakt.post.ts, which uses the pure logic here.
//
// Spam protection works without third-party services or captchas:
// - a honeypot field ("website") that people never see but bots fill in: such a submission
//   gets the normal thank-you page, so the bot learns nothing, but no mail is sent;
// - messages with many links are refused (typical for spam, rare in real enquiries);
// - a rate limit per IP address and in total, kept in memory only (nothing is stored).

/** Largest accepted request body; the form's maxlength values add up to about 7 KB. */
export const MAX_BODY = 20_000

export const LIMITS = { name: 100, email: 200, message: 5000, minMessage: 10, maxLinks: 3 }

export interface ContactForm { name: string, email: string, message: string }

export type ParseResult =
  | { kind: 'ok', form: ContactForm }
  | { kind: 'spam' }
  | { kind: 'invalid', reason: string }

/** Same rule as the cockpit's config check: one @, no spaces, a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** One line of text: control characters (also line breaks) become spaces. */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
}

/** Reads the url-encoded form body and checks every field. */
export function parseContactForm(body: string): ParseResult {
  const params = new URLSearchParams(body)
  if ((params.get('website') ?? '') !== '') return { kind: 'spam' }

  const name = oneLine(params.get('name') ?? '')
  const email = oneLine(params.get('email') ?? '')
  // Line breaks are kept in the message; other control characters are dropped.
  // eslint-disable-next-line no-control-regex
  const message = (params.get('message') ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()

  if (name === '' || name.length > LIMITS.name) return { kind: 'invalid', reason: 'name' }
  if (email.length > LIMITS.email || !EMAIL.test(email) || /[<>",;]/.test(email)) return { kind: 'invalid', reason: 'email' }
  if (message.length < LIMITS.minMessage || message.length > LIMITS.message) return { kind: 'invalid', reason: 'message' }
  if ((message.match(/https?:\/\/|www\./gi) ?? []).length > LIMITS.maxLinks) return { kind: 'spam' }
  return { kind: 'ok', form: { name, email, message } }
}

/**
 * Sliding-window rate limit in memory: per key (the IP address) and for all senders together,
 * so a flood from many addresses cannot fill the mailbox either. Restarting the server resets it.
 */
export class ContactLimiter {
  private readonly hits = new Map<string, number[]>()
  private all: number[] = []

  constructor(
    private readonly perKey = 5,
    private readonly total = 30,
    private readonly windowSeconds = 3600,
  ) {}

  /** True and counted if the sender may send now; false if a limit is reached. */
  allow(key: string, now: number): boolean {
    const since = now - this.windowSeconds
    this.all = this.all.filter(t => t > since)
    const mine = (this.hits.get(key) ?? []).filter(t => t > since)
    // Forget addresses whose window has passed, so the map does not grow without bound.
    for (const [k, times] of this.hits) {
      if (times.every(t => t <= since)) this.hits.delete(k)
    }
    if (mine.length >= this.perKey || this.all.length >= this.total) {
      if (mine.length > 0) this.hits.set(key, mine)
      return false
    }
    mine.push(now)
    this.hits.set(key, mine)
    this.all.push(now)
    return true
  }
}

/** The e-mail to the company: plain text; replying goes straight to the visitor. */
export function contactMail(form: ContactForm, to: string, from: string): OutgoingMail {
  return {
    from,
    to,
    replyTo: form.email,
    subject: `Kontaktanfrage von ${form.name}`,
    text: [
      'Neue Nachricht über das Kontaktformular auf der Webseite.',
      '',
      `Name:   ${form.name}`,
      `E-Mail: ${form.email}`,
      '',
      form.message,
      '',
    ].join('\n'),
    attachments: [],
  }
}
