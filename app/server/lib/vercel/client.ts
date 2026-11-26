import { cut, isRecord, printable } from '../text'

// Minimal read-only Vercel REST client for one team (src/Vercel/Client.php).

/** url, headers → status and body. Tests pass a fake. */
export type VercelTransport = (url: string, headers: Record<string, string>) => Promise<{ status: number, body: string }>

const fetchTransport: VercelTransport = async (url, headers) => {
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  return { status: response.status, body: await response.text() }
}

/** Vercel's own explanation of an error, shortened for the dashboard. */
export function vercelReason(body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  const message = error !== null && typeof error.message === 'string' ? printable(error.message) : ''
  return message === '' ? '' : `: ${cut(message, 120)}`
}

export function parseJson(raw: string): unknown {
  try {
    return raw === '' ? null : JSON.parse(raw)
  }
  catch {
    return null
  }
}

export class VercelClient {
  constructor(
    private readonly token: string,
    private readonly teamId: string,
    private readonly apiBase = 'https://api.vercel.com',
    private readonly transport: VercelTransport = fetchTransport,
  ) {}

  async get(path: string, query: Record<string, string | number> = {}): Promise<[number, unknown]> {
    const { status, body } = await this.getRaw(path, query, 'application/json')
    return [status, parseJson(body)]
  }

  /** The undecoded body, e.g. JSON Lines. */
  async getRaw(path: string, query: Record<string, string | number>, accept: string): Promise<{ status: number, body: string }> {
    const params = new URLSearchParams(Object.entries({ ...query, teamId: this.teamId }).map(([k, v]) => [k, String(v)]))
    try {
      return await this.transport(`${this.apiBase}${path}?${params.toString()}`, {
        'Accept': accept,
        'Authorization': `Bearer ${this.token}`,
        'User-Agent': 'steuten-it-project-cockpit',
      })
    }
    catch (e) {
      throw new Error(`Vercel request failed: ${(e as Error).message}`, { cause: e })
    }
  }
}
