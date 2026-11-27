import { describe, expect, it } from 'vitest'
import { mimeMessage } from '../../server/lib/erp/mail'
import { ContactLimiter, contactMail, parseContactForm } from '../../server/lib/website/contact'

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()
const valid = { name: 'Erika Muster', email: 'erika@example.org', message: 'Hallo, ich hätte gern ein Angebot.', website: '' }

describe('parseContactForm', () => {
  it('accepts a normal enquiry', () => {
    expect(parseContactForm(form(valid))).toEqual({ kind: 'ok', form: { name: 'Erika Muster', email: 'erika@example.org', message: 'Hallo, ich hätte gern ein Angebot.' } })
  })

  it('treats a filled honeypot as spam', () => {
    expect(parseContactForm(form({ ...valid, website: 'https://spam.example' })).kind).toBe('spam')
  })

  it('treats many links as spam', () => {
    const message = 'Look: https://a.example https://b.example www.c.example http://d.example'
    expect(parseContactForm(form({ ...valid, message })).kind).toBe('spam')
  })

  it('refuses missing or invalid fields', () => {
    expect(parseContactForm(form({ ...valid, name: '  ' }))).toEqual({ kind: 'invalid', reason: 'name' })
    expect(parseContactForm(form({ ...valid, email: 'keine-adresse' }))).toEqual({ kind: 'invalid', reason: 'email' })
    expect(parseContactForm(form({ ...valid, email: 'a@b.de, c@d.de' }))).toEqual({ kind: 'invalid', reason: 'email' })
    expect(parseContactForm(form({ ...valid, message: 'kurz' }))).toEqual({ kind: 'invalid', reason: 'message' })
    expect(parseContactForm(form({ ...valid, message: 'x'.repeat(5001) }))).toEqual({ kind: 'invalid', reason: 'message' })
  })

  it('removes line breaks from name and address, so they cannot add mail headers', () => {
    const result = parseContactForm(form({ ...valid, name: 'Erika\r\nBcc: victim@example.org', email: 'erika@example.org\nBcc: x@example.org' }))
    expect(result.kind).toBe('invalid')
    const named = parseContactForm(form({ ...valid, name: 'Erika\r\nBcc: victim@example.org' }))
    expect(named.kind === 'ok' && named.form.name).toBe('Erika Bcc: victim@example.org')
  })

  it('keeps line breaks in the message', () => {
    const result = parseContactForm(form({ ...valid, message: 'Zeile eins\r\nZeile zwei' }))
    expect(result.kind === 'ok' && result.form.message).toBe('Zeile eins\nZeile zwei')
  })
})

describe('ContactLimiter', () => {
  it('limits each address and all senders together within the window', () => {
    const limiter = new ContactLimiter(2, 3, 60)
    expect(limiter.allow('1.1.1.1', 0)).toBe(true)
    expect(limiter.allow('1.1.1.1', 1)).toBe(true)
    expect(limiter.allow('1.1.1.1', 2)).toBe(false)
    expect(limiter.allow('2.2.2.2', 3)).toBe(true)
    expect(limiter.allow('3.3.3.3', 4)).toBe(false)
    // After the window everything is allowed again.
    expect(limiter.allow('1.1.1.1', 70)).toBe(true)
  })
})

describe('contactMail', () => {
  it('builds a mail to the company that is answered to the visitor', () => {
    const mail = contactMail({ name: 'Erika Muster', email: 'erika@example.org', message: 'Hallo' }, 'info@example.com', 'Webseite <noreply@example.com>')
    expect(mail.replyTo).toBe('erika@example.org')
    expect(mail.subject).toBe('Kontaktanfrage von Erika Muster')
    const raw = mimeMessage(mail)
    expect(raw).toContain('Reply-To: erika@example.org\r\n')
    expect(raw).toContain('To: info@example.com\r\n')
  })
})
