import { createPrivateKey, sign } from 'node:crypto'
import { cut, isRecord, printable } from '../text'

// Minimal REST client for a GitHub App, like src/GitHub/Client.php: signs the app JWT,
// exchanges it for installation tokens and performs requests. Writes are used only for
// bug reports, with tokens limited to the reports repository.

const API_VERSION = '2026-03-10'
const USER_AGENT = 'steuten-it-project-cockpit'

export interface HttpResponse { status: number, headers: Record<string, string>, body: string }
/** method, url, headers, body → response. Tests pass a fake; production uses fetch. */
export type HttpTransport = (method: string, url: string, headers: Record<string, string>, body?: string) => Promise<HttpResponse>

export const fetchTransport: HttpTransport = async (method, url, headers, body) => {
  const response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  const out: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return { status: response.status, headers: out, body: await response.text() }
}

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64url')
}

/** GitHub's own explanation of an error, shortened and printable, e.g. ": Bad credentials". Never contains secrets. */
export function reason(body: unknown): string {
  const message = isRecord(body) && typeof body.message === 'string' ? printable(body.message) : ''
  return message === '' ? '' : `: ${cut(message, 120)}`
}

export function nextLink(header: string): string | null {
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m) return m[1]!
  }
  return null
}

export class GitHubClient {
  constructor(
    private readonly clientId: string,
    private readonly privateKeyPem: string,
    private readonly apiBase = 'https://api.github.com',
    private readonly transport: HttpTransport = fetchTransport,
  ) {}

  /** App JWT (RS256), valid for 9 minutes; iat 60 s in the past against clock drift, as GitHub recommends. */
  jwt(now: number): string {
    let key
    try {
      key = createPrivateKey(this.privateKeyPem)
    }
    catch {
      throw new Error('GitHub App private key could not be read.')
    }
    const input = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.clientId }))}`
    return `${input}.${base64url(sign('sha256', Buffer.from(input), key))}`
  }

  async installations(now: number): Promise<{ id: number, account: string }[]> {
    const items = await this.paginate('/app/installations?per_page=100', this.jwt(now))
    return items.flatMap(item => (isRecord(item) && typeof item.id === 'number' && isRecord(item.account) && typeof item.account.login === 'string')
      ? [{ id: item.id, account: item.account.login }]
      : [])
  }

  /** A token of one installation, optionally limited to repositories (names without owner) and permissions. */
  async installationToken(installationId: number, now: number, repositories: string[] = [], permissions: Record<string, string> = {}): Promise<string> {
    const scope: Record<string, unknown> = {}
    if (repositories.length > 0) scope.repositories = repositories
    if (Object.keys(permissions).length > 0) scope.permissions = permissions
    const { status, body } = await this.request('POST', `/app/installations/${installationId}/access_tokens`, this.jwt(now), Object.keys(scope).length === 0 ? undefined : scope)
    if (status !== 201 || !isRecord(body) || typeof body.token !== 'string') {
      throw new Error(`GitHub returned ${status} for an installation token${reason(body)}.`)
    }
    return body.token
  }

  async get(path: string, token: string): Promise<[number, unknown]> {
    const { status, body } = await this.request('GET', path, token)
    return [status, body]
  }

  /** A request with a JSON body (POST, PUT, PATCH), e.g. to create an issue. */
  async send(method: string, path: string, token: string, json: Record<string, unknown>): Promise<[number, unknown]> {
    const { status, body } = await this.request(method, path, token, json)
    return [status, body]
  }

  /** Follows Link: rel="next" and returns all items; `key` selects the list inside an object response. */
  async paginate(path: string, token: string, key: string | null = null, maxPages = 10): Promise<unknown[]> {
    const items: unknown[] = []
    let url: string | null = path
    const name = path.split('?')[0]
    for (let page = 0; url !== null && page < maxPages; page++) {
      const { status, headers, body }: { status: number, headers: Record<string, string>, body: unknown } = await this.request('GET', url, token)
      if (status !== 200) {
        throw new Error(`GitHub returned ${status} for ${name}${reason(body)}.`)
      }
      const list = key === null ? body : (isRecord(body) ? body[key] : null)
      if (!Array.isArray(list)) {
        throw new Error(`Unexpected response for ${name}.`)
      }
      items.push(...list)
      url = nextLink(headers.link ?? '')
    }
    return items
  }

  private async request(method: string, pathOrUrl: string, bearer: string, json?: Record<string, unknown>) {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : this.apiBase + pathOrUrl
    // Never send the token anywhere but the configured API origin, even if a Link header pointed elsewhere.
    if (!url.startsWith(`${this.apiBase}/`)) {
      throw new Error('Refusing to call a URL outside the GitHub API.')
    }
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${bearer}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': API_VERSION,
    }
    let payload: string | undefined
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(json)
    }
    let response: HttpResponse
    try {
      response = await this.transport(method, url, headers, payload)
    }
    catch (e) {
      throw new Error(`GitHub request failed: ${(e as Error).message}`, { cause: e })
    }
    let body: unknown = null
    if (response.body !== '') {
      try {
        body = JSON.parse(response.body)
      }
      catch {
        body = null
      }
    }
    return { status: response.status, headers: response.headers, body }
  }
}
