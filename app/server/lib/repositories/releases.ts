import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { ReleaseRun } from '#shared/types/cockpit'
import { releaseRuns } from '../../database/schema'
import type { Database } from '../db'
import type { ReleaseRow } from '../releases/run'
import { SYNC } from '../releases/run'

// release_runs (src/Releases/ReleaseRepository.php).

export class ReleaseRepository {
  constructor(private readonly db: Database) {}

  /**
   * Inserts or refreshes a run. Status and conclusion change only if the run's updated_at
   * is not older than the stored one (webhooks can arrive out of order); a known publishing
   * flag and core version are kept. updated_at is assigned last: MariaDB evaluates the
   * assignments in order, so the conditions before it still see the stored value.
   */
  async upsert(row: ReleaseRow): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO release_runs (id, workflow, channel, branch, event, status, conclusion, publishing, title, head_sha, html_url, started_at, updated_at)
      VALUES (${row.id}, ${row.workflow}, ${row.channel}, ${row.branch}, ${row.event}, ${row.status}, ${row.conclusion}, ${row.publishing},
              ${row.title}, ${row.headSha}, ${row.htmlUrl}, ${row.startedAt}, ${row.updatedAt})
      ON DUPLICATE KEY UPDATE
        status = IF(VALUES(updated_at) >= updated_at, VALUES(status), status),
        conclusion = IF(VALUES(updated_at) >= updated_at, VALUES(conclusion), conclusion),
        publishing = COALESCE(publishing, VALUES(publishing)),
        title = COALESCE(VALUES(title), title),
        updated_at = GREATEST(updated_at, VALUES(updated_at))`)
  }

  /** A publishing job of this sync run was seen. Unknown runs are ignored. */
  async markPublishing(runId: number): Promise<void> {
    await this.db.update(releaseRuns).set({ publishing: 1 }).where(and(eq(releaseRuns.id, runId), eq(releaseRuns.workflow, SYNC)))
  }

  async setPublishing(runId: number, publishing: boolean): Promise<void> {
    await this.db.update(releaseRuns).set({ publishing: publishing ? 1 : 0 }).where(eq(releaseRuns.id, runId))
  }

  async setCoreVersion(runId: number, version: string): Promise<void> {
    await this.db.update(releaseRuns).set({ coreVersion: version }).where(eq(releaseRuns.id, runId))
  }

  /** Runs since `since` still lacking data: unknown publishing, or publishing without core version. Newest first. */
  async pending(since: string, limit: number): Promise<ReleaseRun[]> {
    return this.db.select().from(releaseRuns)
      .where(and(gte(releaseRuns.startedAt, since), or(isNull(releaseRuns.publishing), and(eq(releaseRuns.publishing, 1), isNull(releaseRuns.coreVersion)))))
      .orderBy(desc(releaseRuns.startedAt)).limit(Math.max(1, limit))
  }

  async find(runId: number): Promise<ReleaseRun | null> {
    const [row] = await this.db.select().from(releaseRuns).where(eq(releaseRuns.id, runId)).limit(1)
    return row ?? null
  }

  /** Runs that publish, newest first. */
  async releases(limit: number): Promise<ReleaseRun[]> {
    return this.db.select().from(releaseRuns).where(eq(releaseRuns.publishing, 1))
      .orderBy(desc(releaseRuns.startedAt)).limit(Math.max(1, limit))
  }

  /** Removes runs without a release started before `quiet` and all runs started before `all`. */
  async prune(quiet: string, all: string): Promise<void> {
    await this.db.delete(releaseRuns).where(and(or(isNull(releaseRuns.publishing), eq(releaseRuns.publishing, 0)), lt(releaseRuns.startedAt, quiet)))
    await this.db.delete(releaseRuns).where(lt(releaseRuns.startedAt, all))
  }
}
