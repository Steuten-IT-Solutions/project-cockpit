import { asc, eq, notInArray } from 'drizzle-orm'
import type { VercelProject } from '#shared/types/cockpit'
import { vercelProjects } from '../../database/schema'
import type { Database } from '../db'

// vercel_projects, like src/Vercel/VercelRepository.php.

export class VercelRepository {
  constructor(private readonly db: Database) {}

  async all(): Promise<VercelProject[]> {
    const rows = await this.db.select().from(vercelProjects).where(eq(vercelProjects.available, true)).orderBy(asc(vercelProjects.name))
    return rows.map(({ available: _a, ...v }) => v)
  }

  async upsert(row: VercelProject): Promise<void> {
    const { id: _id, ...updates } = row
    await this.db.insert(vercelProjects).values({ ...row, available: true })
      .onDuplicateKeyUpdate({ set: { ...updates, available: true } })
  }

  async markUnavailableExcept(ids: string[]): Promise<void> {
    await this.db.update(vercelProjects).set({ available: false })
      .where(ids.length === 0 ? undefined : notInArray(vercelProjects.id, ids))
  }
}

/**
 * Vercel projects by the GitHub repository they deploy: by repository id, or by
 * owner/name when Vercel reported no id. An id only counts if a card exists for it.
 */
export function vercelByRepository(list: VercelProject[], repos: { id: number, fullName: string }[]): Record<number, VercelProject[]> {
  const byName = new Map(repos.map(r => [r.fullName.toLowerCase(), r.id]))
  const known = new Set(repos.map(r => r.id))
  const map: Record<number, VercelProject[]> = {}
  for (const project of list) {
    let repoId = project.repoId !== null && known.has(project.repoId) ? project.repoId : null
    if (repoId === null && project.repoFullName !== null) {
      repoId = byName.get(project.repoFullName.toLowerCase()) ?? null
    }
    if (repoId !== null) {
      (map[repoId] ??= []).push(project)
    }
  }
  return map
}
