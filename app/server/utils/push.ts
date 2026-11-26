import { readFile } from 'node:fs/promises'
import type { H3Event } from 'h3'
import { WebPush } from '../lib/push'

/** The VAPID signer, or null if push is not configured or the key file is unusable. */
export async function webPush(event?: H3Event): Promise<WebPush | null> {
  const push = cockpitConfig(event).push
  if (push === null) return null
  try {
    return new WebPush(await readFile(push.privateKeyFile, 'utf8'), push.subject)
  }
  catch {
    return null
  }
}
