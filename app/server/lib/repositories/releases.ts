import { desc, eq } from 'drizzle-orm'
import type { ReleaseRun } from '#shared/types/cockpit'
import { releaseRuns } from '../../database/schema'
import type { Database } from '../db'

// release_runs, read side (src/Releases/ReleaseRepository.php). The sync and the
// webhook add their writes in server/lib/releases/.

export class ReleaseRepository {
  constructor(private readonly db: Database) {}

  /** Runs that publish, newest first. */
  async releases(limit: number): Promise<ReleaseRun[]> {
    return this.db.select().from(releaseRuns).where(eq(releaseRuns.publishing, 1))
      .orderBy(desc(releaseRuns.startedAt)).limit(Math.max(1, limit))
  }
}
