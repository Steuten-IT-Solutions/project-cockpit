import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { bareAddress, encodeHeader } from '../status/notifier'

// E-mails with attachments (invoices, reminders, quotes), sent through the server's
// sendmail (Postfix) like the alert e-mails. The message is built here as MIME
// multipart/mixed; text and files are base64 so no line can be too long.

export interface Attachment { filename: string, contentType: string, content: Buffer }

export interface OutgoingMail {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  text: string
  attachments: Attachment[]
}

/** 76-character lines, as MIME requires for base64. */
function base64Lines(content: Buffer): string {
  return content.toString('base64').replace(/.{76}/g, '$&\r\n')
}

/** RFC 2231 filename parameter for names that are not plain ASCII. */
function filenameParameter(name: string): string {
  return /^[\w.-]+$/.test(name) ? `filename="${name}"` : `filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Refuses header values with line breaks: they could add headers (header injection). */
function header(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('A mail header must not contain line breaks.')
  return value
}

export function mimeMessage(mail: OutgoingMail, now = new Date()): string {
  const boundary = `cockpit-${randomBytes(12).toString('hex')}`
  const domain = bareAddress(mail.from).split('@')[1] ?? 'localhost'
  const lines = [
    `From: ${header(mail.from)}`,
    `To: ${header(mail.to)}`,
    ...(mail.replyTo ? [`Reply-To: ${header(mail.replyTo)}`] : []),
    `Subject: ${encodeHeader(header(mail.subject))}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8')),
  ]
  for (const file of mail.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${header(file.contentType)}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${filenameParameter(header(file.filename))}`,
      '',
      base64Lines(file.content),
    )
  }
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}

export type MailSender = (mail: OutgoingMail) => Promise<void>

/** Pipes the message into sendmail; throws if it cannot be handed over. */
export function sendmailSender(binary: string): MailSender {
  return mail => new Promise((resolve, reject) => {
    const recipient = bareAddress(mail.to)
    const message = mimeMessage(mail)
    // -i: a line with a single dot does not end the message; -f: envelope sender for bounces.
    const child = spawn(binary, ['-i', '-f', bareAddress(mail.from), '--', recipient], { stdio: ['pipe', 'ignore', 'pipe'] })
    const err: Buffer[] = []
    child.stderr.on('data', (c: Buffer) => err.push(c))
    child.on('error', e => reject(new Error(`sendmail could not be started: ${e.message}`)))
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`sendmail failed (exit ${code}): ${Buffer.concat(err).toString('utf8').slice(0, 500)}`))))
    child.stdin.on('error', () => {})
    child.stdin.end(message)
  })
}
