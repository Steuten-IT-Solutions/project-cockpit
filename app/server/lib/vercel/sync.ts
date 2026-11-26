import type { VercelProject } from '#shared/types/cockpit'
import type { VercelRepository } from '../repositories/vercel'
import { cut, isRecord } from '../text'
import { type VercelClient, vercelReason } from './client'

// Every project of the team with its latest production deployment (src/Vercel/Sync.php
// and VercelSnapshot.php). The GitHub repository in a project's link ties it to a card.

/** A production alias, preferring a custom domain over *.vercel.app, then the shortest. */
export function productionDomain(project: Record<string, unknown>): string | null {
  const candidates: string[] = []
  for (const alias of Array.isArray(project.alias) ? project.alias : []) {
    if (!isRecord(alias) || typeof alias.domain !== 'string') continue
    const production = alias.target === 'PRODUCTION' || alias.environment === 'production'
    if (production && /^[a-z0-9.-]{1,253}$/i.test(alias.domain)) candidates.push(alias.domain.toLowerCase())
  }
  const rank = (d: string) => [d.endsWith('.vercel.app') ? 1 : 0, d.length] as const
  candidates.sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1])
  return candidates[0] ?? null
}

function vercelUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://vercel.com/') && value.length <= 300 ? value : null
}

/** Vercel timestamps are milliseconds since the epoch. */
function msTime(value: unknown): string | null {
  return typeof value === 'number' ? new Date(Math.trunc(value / 1000) * 1000).toISOString().slice(0, 19).replace('T', ' ') : null
}

export function vercelSnapshot(project: Record<string, unknown>, deployment: Record<string, unknown> | null, syncedAt: string): VercelProject {
  const link = isRecord(project.link) ? project.link : {}
  const repoId = link.repoId
  const state = deployment === null ? null : (deployment.state ?? deployment.readyState ?? null)
  const commit = deployment !== null && isRecord(deployment.meta) ? deployment.meta.githubCommitMessage : null
  return {
    id: cut(String(project.id), 64),
    name: cut(typeof project.name === 'string' ? project.name : '', 100),
    repoId: typeof repoId === 'number' && Number.isInteger(repoId) ? repoId : (typeof repoId === 'string' && /^\d+$/.test(repoId) ? Number(repoId) : null),
    repoFullName: typeof link.org === 'string' && typeof link.repo === 'string' ? cut(`${link.org}/${link.repo}`, 200) : null,
    productionDomain: productionDomain(project),
    deployState: typeof state === 'string' ? cut(state, 20) : null,
    deployCreatedAt: deployment !== null ? msTime(deployment.created ?? deployment.createdAt) : null,
    deployInspectorUrl: deployment !== null ? vercelUrl(deployment.inspectorUrl) : null,
    deployCommit: typeof commit === 'string' ? cut(commit.split('\n').find(l => l !== '') ?? '', 255) : null,
    deployError: deployment !== null && typeof deployment.errorMessage === 'string' ? cut(deployment.errorMessage, 255) : null,
    syncedAt,
  }
}

export async function syncVercel(client: VercelClient, store: VercelRepository, syncedAt: string) {
  const [status, body] = await client.get('/v10/projects', { limit: 100 })
  if (status !== 200) {
    throw new Error(`Vercel returned ${status} for /v10/projects${vercelReason(body)}.`)
  }
  // The endpoint answers with either a bare list or {projects, pagination}.
  const projects = Array.isArray(body) ? body : (isRecord(body) ? body.projects : null)
  if (!Array.isArray(projects)) {
    throw new Error('Unexpected response for /v10/projects.')
  }
  const seen: string[] = []
  const errors: string[] = []
  for (const project of projects) {
    if (!isRecord(project) || typeof project.id !== 'string') continue
    seen.push(project.id)
    try {
      const [s, deployments] = await client.get('/v7/deployments', { projectId: project.id, target: 'production', limit: 1 })
      if (s !== 200) {
        throw new Error(`Vercel returned ${s} for deployments${vercelReason(deployments)}`)
      }
      const first = isRecord(deployments) && Array.isArray(deployments.deployments) ? deployments.deployments[0] : null
      await store.upsert(vercelSnapshot(project, isRecord(first) ? first : null, syncedAt))
    }
    catch (e) {
      errors.push(`${typeof project.name === 'string' ? project.name : project.id}: ${(e as Error).message}`)
    }
  }
  await store.markUnavailableExcept(seen)
  return { projects: seen.length, errors }
}
