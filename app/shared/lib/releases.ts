import type { ReleaseChannel, ReleaseRun } from '../types/cockpit'

// The release box of the dashboard, like src/Releases/ReleaseView.php.

export const RELEASE_CHANNELS: Record<string, string> = { early: 'Early', stable: 'Stable' }

/** Per channel: releases running now, the last successful one, and a failed run after it. Runs newest first. */
export function releaseSummary(releases: ReleaseRun[]): Record<string, ReleaseChannel> {
  const summary: Record<string, ReleaseChannel> = {}
  for (const channel of Object.keys(RELEASE_CHANNELS)) {
    const running: ReleaseRun[] = []
    let last: ReleaseRun | null = null
    let failed: ReleaseRun | null = null
    for (const run of releases) {
      if (run.channel !== channel || run.publishing !== 1) continue
      if (run.status !== 'completed') {
        running.push(run)
      }
      else if (run.conclusion === 'success') {
        last = run
        break
      }
      else {
        failed ??= run
      }
    }
    summary[channel] = { running, last, failed }
  }
  return summary
}

/** German label of a run that did not succeed. */
export function releaseConclusion(conclusion: string | null): string {
  switch (conclusion) {
    case 'failure': case 'startup_failure': return 'fehlgeschlagen'
    case 'cancelled': return 'abgebrochen'
    case 'timed_out': return 'Zeit überschritten'
    default: return `beendet: ${conclusion ?? 'unbekannt'}`
  }
}
