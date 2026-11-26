import type { Alert, Installation, Project, StatusReport, VercelProject } from '#shared/types/cockpit'
import { reportsByRepository } from './repositories/status'
import { vercelByRepository } from './repositories/vercel'

// Groups the raw lists for the dashboard, like App::dashboard() and the top of
// templates/dashboard.php. Pure, so the rules are unit tested.

export interface DashboardInput {
  projects: Project[]
  vercel: VercelProject[]
  reports: StatusReport[]
  installations: Installation[]
  openAlerts: Alert[]
  showHidden: boolean
}

export function groupDashboard(input: DashboardInput) {
  const repos = input.projects.map(p => ({ id: p.id, fullName: p.fullName }))
  const vercelByRepo = vercelByRepository(input.vercel, repos)
  const matched = new Set(Object.values(vercelByRepo).flat().map(v => v.id))
  const vercelUnmatched = input.vercel.filter(v => !matched.has(v.id))

  const reportsByRepo = reportsByRepository(input.reports, repos)
  // Project card of each reporting company, to link the installation to it.
  const reportProject: Record<string, number> = {}
  for (const [repoId, list] of Object.entries(reportsByRepo)) {
    for (const r of list) reportProject[`${r.kompanie}|${r.variant}`] = Number(repoId)
  }

  // Latest release tag by lower-cased repository name, to compare installed versions with.
  const releaseByRepo: Record<string, string> = {}
  for (const p of input.projects) {
    if (p.releaseTag !== null) releaseByRepo[p.fullName.toLowerCase()] = p.releaseTag
  }

  // Format 1 rows of companies that already send format 2 are outdated.
  const format2 = new Set(input.installations.map(i => `${i.kompanie.toLowerCase()}|${i.variant}`))
  const reports = input.reports.filter(r => !format2.has(`${r.kompanie.toLowerCase()}|${r.variant}`))

  const repoByName = new Map(input.projects.map(p => [p.fullName.toLowerCase(), p.id]))
  const installationsByRepo: Record<number, string[]> = {}
  for (const i of input.installations) {
    const repoId = repoByName.get(i.kompanie.toLowerCase())
    if (repoId !== undefined) (installationsByRepo[repoId] ??= []).push(i.id)
  }

  const hiddenCount = input.projects.filter(p => p.hidden).length
  const projects = input.showHidden ? input.projects : input.projects.filter(p => !p.hidden)

  return { projects, hiddenCount, vercelByRepo, vercelUnmatched, reportsByRepo, reportProject, releaseByRepo, reports, installationsByRepo }
}
