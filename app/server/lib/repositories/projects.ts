import { desc, eq, getTableColumns, max, notInArray, sql } from 'drizzle-orm'
import type { Project, ProjectNote } from '#shared/types/cockpit'
import { projectNotes, projects } from '../../database/schema'
import type { Database } from '../db'
import { utc } from '../time'

// projects and project_notes, like src/Projects/ProjectRepository.php and NoteRepository.php.

export type ProjectRow = typeof projects.$inferInsert

const hasNote = sql<number>`EXISTS (SELECT 1 FROM ${projectNotes} n WHERE n.project_id = ${projects.id})`.as('has_note')

function hydrate(row: typeof projects.$inferSelect & { hasNote: number | string }): Project {
  return { ...row, hasNote: Number(row.hasNote) === 1 }
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  /** Projects still granted to the GitHub App, most recently pushed first. */
  async all(): Promise<Project[]> {
    const rows = await this.db.select({ ...getColumns(), hasNote }).from(projects)
      .where(eq(projects.available, true))
      .orderBy(sql`${projects.pushedAt} IS NULL`, desc(projects.pushedAt), projects.fullName)
    return rows.map(hydrate)
  }

  async find(id: number): Promise<Project | null> {
    const rows = await this.db.select({ ...getColumns(), hasNote }).from(projects).where(eq(projects.id, id)).limit(1)
    return rows[0] === undefined ? null : hydrate(rows[0])
  }

  async setHidden(id: number, hidden: boolean): Promise<void> {
    await this.db.update(projects).set({ hidden }).where(eq(projects.id, id))
  }

  async lastSync(): Promise<string | null> {
    const [row] = await this.db.select({ v: max(projects.syncedAt) }).from(projects)
    return row?.v ?? null
  }

  /** Inserts or refreshes a project from the GitHub sync. hidden and notes belong to the user and stay. */
  async upsert(row: Omit<ProjectRow, 'available' | 'hidden' | 'syncError'>): Promise<void> {
    const { id: _id, ...updates } = row
    await this.db.insert(projects).values({ ...row, available: true, syncError: null })
      .onDuplicateKeyUpdate({ set: { ...updates, available: true, syncError: null } })
  }

  async markError(id: number, message: string): Promise<void> {
    await this.db.update(projects).set({ syncError: message.slice(0, 255) }).where(eq(projects.id, id))
  }

  /** Repositories no longer granted stay in the table (their notes survive) but are flagged. */
  async markUnavailableExcept(ids: number[]): Promise<void> {
    await this.db.update(projects).set({ available: false })
      .where(ids.length === 0 ? undefined : notInArray(projects.id, ids))
  }
}

function getColumns() {
  return getTableColumns(projects)
}

/** Notes per project: every save adds a version, the newest is the current note. */
export class NoteRepository {
  static readonly MAX_LENGTH = 100_000

  constructor(private readonly db: Database) {}

  async history(projectId: number, limit = 20): Promise<ProjectNote[]> {
    return this.db.select({ id: projectNotes.id, body: projectNotes.body, createdAt: projectNotes.createdAt })
      .from(projectNotes).where(eq(projectNotes.projectId, projectId))
      .orderBy(desc(projectNotes.id)).limit(Math.max(1, Math.min(limit, 100)))
  }

  /** Stores a new version unless the text is unchanged. Returns whether something was saved. */
  async save(projectId: number, input: string, userId: number): Promise<boolean> {
    const body = input.replaceAll('\r\n', '\n')
    const [current] = await this.history(projectId, 1)
    if (current !== undefined && current.body === body) {
      return false
    }
    await this.db.insert(projectNotes).values({ projectId, body, userId, createdAt: utc() })
    return true
  }
}
