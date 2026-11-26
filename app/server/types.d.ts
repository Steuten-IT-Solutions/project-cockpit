import type { Session } from './lib/session'
import type { SessionState } from './utils/state'

declare module 'h3' {
  interface H3EventContext {
    session?: Session
    cockpit?: SessionState & { flash: string | null }
  }
}

export {}
