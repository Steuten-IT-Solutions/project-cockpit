import type { H3Event } from 'h3'
import { sendmailSender } from '../../lib/erp/mail'
import { ContactLimiter, contactMail, MAX_BODY, parseContactForm } from '../../lib/website/contact'

// The contact form of the company website. The website itself is static HTML that Apache
// serves from website/ on www; only POST /kontakt/senden is forwarded here (bin/server-setup.sh,
// step "website"). No session, no JSON: the browser posts the form and gets redirected to a
// static page, so the site needs no JavaScript.

/** One limiter for the whole process (see ContactLimiter: memory only, reset on restart). */
const limiter = new ContactLimiter()

/** The body, but at most limit + 1 bytes (one more than allowed marks it as too large). */
async function readCapped(event: H3Event, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = chunk as Buffer
    if (size <= limit) chunks.push(buffer.subarray(0, limit + 1 - size))
    size += buffer.length
  }
  return Buffer.concat(chunks).toString('utf8')
}

export default defineEventHandler(async (event) => {
  const website = useRuntimeConfig(event).website
  // Only through the website's own host name, never through the cockpit's address.
  if (website.host === '' || getRequestHost(event, { xForwardedHost: false }) !== website.host) {
    // A plain answer: a thrown error would render the cockpit's error page (and its login).
    setResponseStatus(event, 404)
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return 'Not Found'
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const done = (page: 'danke' | 'fehler') => sendRedirect(event, `/kontakt/${page}/`, 303)

  const body = await readCapped(event, MAX_BODY)
  if (body.length > MAX_BODY) return done('fehler')
  const result = parseContactForm(body)
  // Bots get the normal answer, so they cannot tell that nothing was sent.
  if (result.kind === 'spam') return done('danke')
  if (result.kind === 'invalid') return done('fehler')
  if (!limiter.allow(clientIp(event), Math.floor(Date.now() / 1000))) return done('fehler')

  try {
    const send = sendmailSender(cockpitConfig(event).mail.sendmail)
    await send(contactMail(result.form, website.contactTo, website.contactFrom))
  }
  catch (e) {
    console.error('[website contact] sending failed:', e)
    return done('fehler')
  }
  return done('danke')
})
