import type { H3Event } from 'h3'
import type { CockpitSession } from '#shared/types/session'

export type SessionState = Omit<CockpitSession, 'flash'>

/** Pending logins expire after 5 minutes, like in the PHP cockpit. */
export const PENDING_SECONDS = 5 * 60

export async function sessionState(event: H3Event): Promise<SessionState> {
  const session = requireSession(event)
  const { users } = useCockpit(event)
  const user = session.userId === null ? null : await users.findById(session.userId)
  return {
    user: user === null ? null : { id: user.id, username: user.username },
    pending: (await pendingUser(event)) !== null,
    csrf: session.data.csrf,
  }
}

export async function pendingUser(event: H3Event) {
  const session = requireSession(event)
  const { pendingUser: id, pendingAt } = session.data
  if (id === undefined || pendingAt === undefined || Date.now() / 1000 - pendingAt > PENDING_SECONDS) {
    return null
  }
  return useCockpit(event).users.findById(id)
}
