// Data the API sends to the pages. Timestamps are UTC strings 'YYYY-MM-DD HH:MM:SS'
// as stored; the pages format them with shared/lib/format.ts. Secrets (encrypted
// installation secrets, tokens) never appear in these types.

export interface Project {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  htmlUrl: string
  isPrivate: boolean
  isArchived: boolean
  isFork: boolean
  defaultBranch: string
  pushedAt: string | null
  openIssues: number
  openPrs: number
  releaseTag: string | null
  releaseUrl: string | null
  releaseAt: string | null
  ciStatus: string | null
  ciConclusion: string | null
  ciUrl: string | null
  ciAt: string | null
  ciWorkflow: string | null
  syncError: string | null
  syncedAt: string
  available: boolean
  hidden: boolean
  hasNote: boolean
}

export interface VercelProject {
  id: string
  name: string
  repoId: number | null
  repoFullName: string | null
  productionDomain: string | null
  deployState: string | null
  deployCreatedAt: string | null
  deployInspectorUrl: string | null
  deployCommit: string | null
  deployError: string | null
  syncedAt: string
}

/** Format 1 status report (daily, unsigned). */
export interface StatusReport {
  kompanie: string
  variant: string
  version: string
  php: string
  dbDriver: string
  updateOk: boolean | null
  updateAt: string | null
  updateTo: string | null
  updateCheckOk: boolean
  galleryOk: boolean | null
  galleryAt: string | null
  sentAt: string | null
  receivedAt: string
}

/** Format 2 and 3: one installation of a company app. */
export interface Installation {
  id: string
  kompanie: string
  variant: string
  version: string
  php: string
  dbDriver: string
  cronKind: string
  cronLast: string | null
  checks: Record<string, string>
  errors: Record<string, number>
  details: Record<string, Record<string, number>>
  features: string[]
  updateOk: boolean | null
  updateAt: string | null
  updateTo: string | null
  updateCheckOk: boolean
  galleryOk: boolean | null
  galleryAt: string | null
  maintenance: boolean
  firstSeen: string
  lastSeen: string
  lastHeartbeat: string | null
}

export interface Alert {
  id: number
  installationId: string | null
  kompanie: string
  variant: string | null
  alertKey: string
  detail: string
  openedAt: string
  lastSeenAt: string
  notifiedAt: string | null
  resolvedAt: string | null
  resolvedNotifiedAt: string | null
}

export interface ReleaseRun {
  id: number
  workflow: string
  channel: string
  branch: string
  event: string
  status: string
  conclusion: string | null
  publishing: number | null
  title: string | null
  headSha: string
  htmlUrl: string
  startedAt: string
  updatedAt: string
  coreVersion: string | null
}

export interface ReleaseChannel {
  running: ReleaseRun[]
  last: ReleaseRun | null
  failed: ReleaseRun | null
}

export interface ReleasesBox {
  repo: string | null
  webhook: boolean
  /** null: no data yet. Keyed by channel (early, stable). */
  summary: Record<string, ReleaseChannel> | null
  now: number
}

export interface Cost {
  id: number
  name: string
  provider: string | null
  amountCents: number
  currency: string
  billingInterval: string
  projectId: number | null
  projectName: string | null
  note: string | null
  createdAt: string
}

export interface CronRun {
  startedAt: string
  finishedAt: string | null
  phpVersion: string
  phpSapi: string
  status: string
  message: string | null
}

export interface Dashboard {
  now: number
  githubConfigured: boolean
  statusReceiver: boolean
  /** null: the sync has not run yet. */
  projects: Project[] | null
  hiddenCount: number
  lastSync: string | null
  vercelByRepo: Record<number, VercelProject[]>
  vercelUnmatched: VercelProject[]
  /** Format 1 reports of companies that do not send format 2 yet. */
  reports: StatusReport[]
  reportProject: Record<string, number>
  installations: Installation[]
  installationsByRepo: Record<number, string[]>
  openAlerts: Alert[]
  releaseByRepo: Record<string, string>
  reportsByRepo: Record<number, StatusReport[]>
  system: {
    runtime: string
    schemaVersion: string | null
    lastCron: CronRun | null
    recoveryLeft: number
    events: { event: string, createdAt: string }[]
  }
}

export interface ProjectNote {
  id: number
  body: string
  createdAt: string
}

export interface ProjectPage {
  now: number
  project: Project
  vercel: VercelProject[]
  reports: StatusReport[]
  installations: Installation[]
  alertsByInstallation: Record<string, Alert[]>
  costs: Cost[]
  history: ProjectNote[]
}
