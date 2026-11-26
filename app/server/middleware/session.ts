import { Session } from '../lib/session'

// Runs before every server route and page render: loads the session and rejects
// state-changing requests without a valid CSRF token or from another origin.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler(async (event) => {
  const path = event.path
  if (path.startsWith('/_nuxt/') || path.startsWith('/__nuxt') || path === '/favicon.ico') {
    return
  }

  const config = useRuntimeConfig(event)
  const { db } = useCockpit(event)
  // Requests a page sends on its own mark themselves, so they do not count as activity.
  const touch = getRequestHeader(event, 'x-cockpit-poll') === undefined
  event.context.session = await Session.load(db, getCookie(event, sessionCookieName(event)), config.session, touch)

  if (!SAFE_METHODS.has(event.method)) {
    const origin = getRequestHeader(event, 'origin')
    if (origin !== undefined && !sameHost(origin, event)) {
      throw createError({ statusCode: 403, statusMessage: 'Fremde Herkunft' })
    }
    if (!requireSession(event).isValidCsrf(getRequestHeader(event, 'x-csrf-token'))) {
      throw createError({ statusCode: 403, statusMessage: 'Die Sitzung ist abgelaufen. Bitte lade die Seite neu.' })
    }
  }

  // A page render gets the session state right away (app/plugins/session.ts reads it),
  // so the first page needs no extra request and uses this session's CSRF token.
  if (event.method === 'GET' && !path.startsWith('/api/')) {
    event.context.cockpit = { ...(await sessionState(event)), flash: requireSession(event).takeFlash() ?? null }
  }

  await commitSession(event)
})

/**
 * Compares hosts only: Node sees plain http behind Apache, which keeps the Host
 * header (ProxyPreserveHost On).
 */
function sameHost(origin: string, event: Parameters<typeof getRequestHeader>[0]): boolean {
  const host = getRequestHeader(event, 'host')
  try {
    return host !== undefined && new URL(origin).host === host
  }
  catch {
    return false
  }
}
