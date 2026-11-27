import type { H3Event } from 'h3'
import { AuthLog, Throttle, UserRepository } from '../lib/auth'
import { type CockpitConfig, parseConfig, type RawConfig } from '../lib/config'
import { Crypto, deriveAppKey } from '../lib/crypto'
import { database, databasePool } from '../lib/db'
import { SerialQueue } from '../lib/serial'
import { Session } from '../lib/session'

// Shared services for the server routes. Files in server/utils are auto-imported
// by Nuxt, so routes call useCockpit(event) without an import.

let crypto: { appKey: string, instance: Crypto } | undefined
let settings: { raw: string, config: CockpitConfig } | undefined

/** The validated settings; an invalid value stops every request with a clear log line. */
export function cockpitConfig(event?: H3Event): CockpitConfig {
  const runtime = useRuntimeConfig(event)
  const raw = JSON.stringify(runtime)
  if (settings?.raw !== raw) {
    settings = { raw, config: parseConfig(runtime as unknown as RawConfig) }
  }
  return settings.config
}

export function useCockpit(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (crypto?.appKey !== config.appKey) {
    if (config.appKey === '') {
      throw new Error('NUXT_APP_KEY is not set.')
    }
    crypto = { appKey: config.appKey, instance: new Crypto(deriveAppKey(config.appKey)) }
  }
  const db = database(config.databaseUrl)
  return {
    db,
    pool: databasePool(config.databaseUrl),
    config: cockpitConfig(event),
    crypto: crypto.instance,
    users: new UserRepository(db),
    throttle: new Throttle(db, crypto.instance),
    log: new AuthLog(db, crypto.instance),
  }
}

export function sessionCookieName(event: H3Event): string {
  return useRuntimeConfig(event).secureCookies ? '__Host-cockpit-session' : 'cockpit_session_dev'
}

/** The session the middleware loaded for this request. */
export function requireSession(event: H3Event): Session {
  const session = event.context.session
  if (!(session instanceof Session)) {
    throw createError({ statusCode: 500, statusMessage: 'Session not loaded' })
  }
  return session
}

/** The logged-in user; answers 401 otherwise. Every API route except login calls it. */
export async function requireUser(event: H3Event) {
  const session = requireSession(event)
  const user = session.userId === null ? null : await useCockpit(event).users.findById(session.userId)
  if (user === null) {
    throw createError({ statusCode: 401, statusMessage: 'Bitte melde dich an.' })
  }
  return user
}

/** Writes changes of the session and (re)sends its cookie. Call before answering. */
export async function commitSession(event: H3Event): Promise<void> {
  const session = requireSession(event)
  await session.save()
  // A new session that was never needed is not stored, so it gets no cookie either.
  if (!session.isStored) {
    return
  }
  setCookie(event, sessionCookieName(event), session.token, {
    httpOnly: true,
    secure: useRuntimeConfig(event).secureCookies,
    sameSite: 'strict',
    path: '/',
  })
}

/**
 * The client's IP. Node listens on localhost behind Apache, which appends the real
 * address as the last X-Forwarded-For entry; earlier entries can be set by anyone.
 */
export function clientIp(event: H3Event): string {
  const socket = event.node.req.socket.remoteAddress ?? ''
  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  const loopback = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1'
  if (loopback && forwarded !== undefined) {
    const last = forwarded.split(',').pop()?.trim()
    if (last !== undefined && last !== '') {
      return last
    }
  }
  return socket
}

/** Password and code checks of the login, one at a time (see SerialQueue). */
export const loginQueue = new SerialQueue()
