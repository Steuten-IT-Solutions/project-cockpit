// Labels for project cards, like src/Projects/ProjectView.php.

/** Colour of a badge: ok = green, fail = red, warn = amber, neutral = grey, live = blue (running). */
export type Tone = 'ok' | 'fail' | 'warn' | 'neutral' | 'live'

/** Label and colour for the latest workflow run on the default branch. */
export function ciBadge(status: string | null, conclusion: string | null): [string, Tone] {
  if (status === null) return ['keine CI', 'neutral']
  if (status !== 'completed') return ['CI läuft', 'neutral']
  switch (conclusion) {
    case 'success': return ['CI grün', 'ok']
    case 'failure': case 'timed_out': case 'startup_failure': return ['CI rot', 'fail']
    case 'cancelled': return ['CI abgebrochen', 'warn']
    case 'skipped': case 'neutral': return ['CI übersprungen', 'neutral']
    default: return [`CI ${conclusion ?? 'unbekannt'}`, 'warn']
  }
}

/** Label and colour for the state of the latest production deployment on Vercel. */
export function vercelBadge(state: string | null): [string, Tone] {
  switch (state) {
    case 'READY': return ['Vercel live', 'ok']
    case 'ERROR': return ['Vercel Fehler', 'fail']
    case 'BUILDING': case 'QUEUED': case 'INITIALIZING': return ['Vercel baut', 'neutral']
    case 'CANCELED': return ['Vercel abgebrochen', 'warn']
    case 'BLOCKED': return ['Vercel blockiert', 'warn']
    case null: return ['Vercel: kein Deployment', 'neutral']
    default: return [`Vercel ${state.toLowerCase()}`, 'warn']
  }
}

/** The project's GitHub links in the order of the PHP project page. */
export function projectLinks(htmlUrl: string): [string, string][] {
  return [
    ['Repository', htmlUrl],
    ['Issues', `${htmlUrl}/issues`],
    ['Pull Requests', `${htmlUrl}/pulls`],
    ['Actions', `${htmlUrl}/actions`],
    ['Releases', `${htmlUrl}/releases`],
  ]
}

/** The address of a production domain reported by Vercel. */
export function siteUrl(domain: string): string {
  return `https://${domain}`
}
