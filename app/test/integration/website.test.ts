import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatabase, startServer, stopServer } from './setup'

// The contact form of the company website. Apache forwards POST /kontakt/senden on www to
// /_website/kontakt; here the website's host name is the test server's own address, and a
// stand-in for sendmail writes the message into a file.

const HOST = '127.0.0.1:3999'
const dir = mkdtempSync(join(tmpdir(), 'cockpit-website-'))
const mailFile = join(dir, 'mail.txt')

/** POSTs the form with the given Host header; returns status and redirect target. */
function submit(fields: Record<string, string>, host = HOST): Promise<[number, string]> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: 3999, path: '/_website/kontakt', method: 'POST',
      headers: { 'host': host, 'content-type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      res.resume()
      resolve([res.statusCode ?? 0, String(res.headers.location ?? '')])
    })
    req.on('error', reject)
    req.end(new URLSearchParams(fields).toString())
  })
}

const valid = { name: 'Erika Muster', email: 'erika@example.org', message: 'Hallo, ich hätte gern ein Angebot.', website: '' }

describe('website contact form', () => {
  beforeAll(async () => {
    const sendmail = join(dir, 'sendmail')
    writeFileSync(sendmail, `#!/bin/sh\ncat > '${mailFile}'\n`)
    chmodSync(sendmail, 0o755)
    await resetDatabase()
    await startServer({ NUXT_WEBSITE_HOST: HOST, NUXT_MAIL_SENDMAIL: sendmail, NUXT_WEBSITE_CONTACT_TO: 'info@example.com' })
  }, 60000)
  afterAll(() => {
    stopServer()
    rmSync(dir, { recursive: true, force: true })
  })
  beforeEach(() => rmSync(mailFile, { force: true }))

  it('sends an enquiry to the company and thanks the visitor', async () => {
    expect(await submit(valid)).toEqual([303, '/kontakt/danke/'])
    const mail = readFileSync(mailFile, 'utf8')
    expect(mail).toContain('To: info@example.com\r\n')
    expect(mail).toContain('Reply-To: erika@example.org\r\n')
    expect(Buffer.from(mail.split('\r\n\r\n').at(-1)!.split('\r\n--')[0]!.replace(/\r\n/g, ''), 'base64').toString('utf8')).toContain('Hallo, ich hätte gern ein Angebot.')
  })

  it('thanks bots too, but sends nothing', async () => {
    expect(await submit({ ...valid, website: 'https://spam.example' })).toEqual([303, '/kontakt/danke/'])
    expect(existsSync(mailFile)).toBe(false)
  })

  it('shows the error page for an invalid form', async () => {
    expect(await submit({ ...valid, email: 'keine-adresse' })).toEqual([303, '/kontakt/fehler/'])
    expect(existsSync(mailFile)).toBe(false)
  })

  it('answers only on the website host, without a session or CSRF token', async () => {
    expect((await submit(valid, 'cockpit.example.org'))[0]).toBe(404)
    expect(existsSync(mailFile)).toBe(false)
  })

  it('limits how often one address can send', async () => {
    // Five per hour and address; the first test already sent one.
    for (let i = 0; i < 4; i++) expect(await submit(valid)).toEqual([303, '/kontakt/danke/'])
    expect(await submit(valid)).toEqual([303, '/kontakt/fehler/'])
  })
})
