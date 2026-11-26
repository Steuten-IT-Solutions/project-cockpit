import type { ProjectRepository, ProjectRow } from '../repositories/projects'
import { apiTime, cut, isRecord } from '../text'
import type { GitHubClient } from './client'

// Pulls the state of every repository the GitHub App can see into the projects table
// (src/GitHub/Sync.php and RepoSnapshot.php). Pages only ever read the stored copy.

type Row = Omit<ProjectRow, 'available' | 'hidden' | 'syncError'>

/** Only https links to github.com are stored, so the pages can render them as links safely. */
function githubUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://github.com/') && value.length <= 300 ? value : null
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0)
const str = (v: unknown, max: number) => (typeof v === 'string' ? cut(v, max) : '')
const optional = (v: unknown, max: number) => (typeof v === 'string' && v !== '' ? cut(v, max) : null)

/** Maps the API payloads to a projects row. Pure. */
export function repoSnapshot(repo: Record<string, unknown>, release: Record<string, unknown> | null, run: Record<string, unknown> | null, openPullRequests: number, syncedAt: string): Row {
  return {
    id: int(repo.id),
    fullName: str(repo.full_name, 200),
    owner: str(isRecord(repo.owner) ? repo.owner.login : '', 100),
    name: str(repo.name, 100),
    description: optional(repo.description, 500),
    htmlUrl: githubUrl(repo.html_url) ?? '',
    isPrivate: repo.private === true,
    isArchived: repo.archived === true,
    isFork: repo.fork === true,
    defaultBranch: str(repo.default_branch ?? 'main', 100),
    pushedAt: apiTime(repo.pushed_at),
    // open_issues_count counts open pull requests as well.
    openIssues: Math.max(0, int(repo.open_issues_count) - openPullRequests),
    openPrs: openPullRequests,
    releaseTag: release === null ? null : optional(release.tag_name, 100),
    releaseUrl: release === null ? null : githubUrl(release.html_url),
    releaseAt: release === null ? null : apiTime(release.published_at),
    ciStatus: run === null ? null : optional(run.status, 20),
    ciConclusion: run === null ? null : optional(run.conclusion, 20),
    ciUrl: run === null ? null : githubUrl(run.html_url),
    ciAt: run === null ? null : apiTime(run.updated_at),
    ciWorkflow: run === null ? null : optional(run.name, 200),
    syncedAt,
  }
}

export async function syncGitHub(client: GitHubClient, projects: ProjectRepository, allowedAccounts: string[], now: number, syncedAt: string) {
  const allowed = allowedAccounts.map(a => a.toLowerCase())
  const seen: number[] = []
  const errors: string[] = []

  for (const installation of await client.installations(now)) {
    if (!allowed.includes(installation.account.toLowerCase())) continue
    const token = await client.installationToken(installation.id, now)
    for (const repo of await client.paginate('/installation/repositories?per_page=100', token, 'repositories')) {
      if (!isRecord(repo) || typeof repo.id !== 'number' || typeof repo.full_name !== 'string') continue
      seen.push(repo.id)
      try {
        await projects.upsert(await snapshot(client, repo, token, syncedAt))
      }
      catch (e) {
        errors.push(`${repo.full_name}: ${(e as Error).message}`)
        await projects.markError(repo.id, cut((e as Error).message, 255))
      }
    }
  }
  await projects.markUnavailableExcept(seen)
  return { repos: seen.length, errors }
}

async function snapshot(client: GitHubClient, repo: Record<string, unknown>, token: string, syncedAt: string): Promise<Row> {
  const fullName = String(repo.full_name)
  const slash = fullName.indexOf('/')
  const path = `/repos/${encodeURIComponent(fullName.slice(0, slash))}/${encodeURIComponent(fullName.slice(slash + 1))}`

  const [releaseStatus, release] = await client.get(`${path}/releases/latest`, token)
  const branch = typeof repo.default_branch === 'string' ? repo.default_branch : 'main'
  const [runStatus, runs] = await client.get(`${path}/actions/runs?per_page=1&branch=${encodeURIComponent(branch)}`, token)
  const first = runStatus === 200 && isRecord(runs) && Array.isArray(runs.workflow_runs) ? runs.workflow_runs[0] : null
  const [pullStatus, pulls] = await client.get(`${path}/pulls?state=open&per_page=100`, token)

  return repoSnapshot(
    repo,
    releaseStatus === 200 && isRecord(release) ? release : null,
    isRecord(first) ? first : null,
    pullStatus === 200 && Array.isArray(pulls) ? pulls.length : 0,
    syncedAt,
  )
}
