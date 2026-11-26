import { bigint, boolean, char, customType, date, datetime, decimal, int, mediumtext, mysqlTable, primaryKey, text, tinyint, varchar } from 'drizzle-orm/mysql-core'

// Tables shared with the PHP cockpit. The schema itself is defined by the SQL files
// in ../migrations; these declarations only describe it for typed queries.
// Every DATETIME holds UTC as 'YYYY-MM-DD HH:MM:SS' (see server/lib/time.ts).
// TINYINT(1) columns are declared as boolean: the driver's 0/1 becomes false/true.

/** MEDIUMBLOB (screenshots of bug reports), read and written as a Buffer. */
const mediumblob = customType<{ data: Buffer, driverData: Buffer }>({
  dataType: () => 'mediumblob',
})

const dt = (name: string) => datetime(name, { mode: 'string' })

export const users = mysqlTable('users', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  username: varchar('username', { length: 64 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  totpSecretEnc: varchar('totp_secret_enc', { length: 255 }).notNull(),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  lastLoginAt: datetime('last_login_at', { mode: 'string' }),
})

export const recoveryCodes = mysqlTable('recovery_codes', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  userId: int('user_id', { unsigned: true }).notNull(),
  codeHash: char('code_hash', { length: 64 }).notNull(),
  usedAt: datetime('used_at', { mode: 'string' }),
})

export const authAttempts = mysqlTable('auth_attempts', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  scope: varchar('scope', { length: 16 }).notNull(),
  keyHash: char('key_hash', { length: 64 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
})

export const authEvents = mysqlTable('auth_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: int('user_id', { unsigned: true }),
  event: varchar('event', { length: 32 }).notNull(),
  ipHash: char('ip_hash', { length: 64 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
})

export const webSessions = mysqlTable('web_sessions', {
  id: char('id', { length: 64 }).primaryKey(),
  userId: int('user_id', { unsigned: true }),
  data: text('data').notNull(),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  seenAt: datetime('seen_at', { mode: 'string' }).notNull(),
})

export const cronRuns = mysqlTable('cron_runs', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  startedAt: dt('started_at').notNull(),
  finishedAt: dt('finished_at'),
  // Kept for the PHP cockpit's rows; the Node jobs write their runtime here (e.g. "node 24.22.3").
  phpVersion: varchar('php_version', { length: 32 }).notNull(),
  phpSapi: varchar('php_sapi', { length: 32 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  message: varchar('message', { length: 255 }),
})

export const projects = mysqlTable('projects', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey(),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  owner: varchar('owner', { length: 100 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }),
  htmlUrl: varchar('html_url', { length: 300 }).notNull(),
  isPrivate: boolean('is_private').notNull(),
  isArchived: boolean('is_archived').notNull(),
  isFork: boolean('is_fork').notNull(),
  defaultBranch: varchar('default_branch', { length: 100 }).notNull(),
  pushedAt: dt('pushed_at'),
  openIssues: int('open_issues', { unsigned: true }).notNull().default(0),
  openPrs: int('open_prs', { unsigned: true }).notNull().default(0),
  releaseTag: varchar('release_tag', { length: 100 }),
  releaseUrl: varchar('release_url', { length: 300 }),
  releaseAt: dt('release_at'),
  ciStatus: varchar('ci_status', { length: 20 }),
  ciConclusion: varchar('ci_conclusion', { length: 20 }),
  ciUrl: varchar('ci_url', { length: 300 }),
  ciAt: dt('ci_at'),
  ciWorkflow: varchar('ci_workflow', { length: 200 }),
  syncError: varchar('sync_error', { length: 255 }),
  syncedAt: dt('synced_at').notNull(),
  available: boolean('available').notNull().default(true),
  hidden: boolean('hidden').notNull().default(false),
})

export const projectNotes = mysqlTable('project_notes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
  body: mediumtext('body').notNull(),
  userId: int('user_id', { unsigned: true }),
  createdAt: dt('created_at').notNull(),
})

export const vercelProjects = mysqlTable('vercel_projects', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  repoId: bigint('repo_id', { mode: 'number', unsigned: true }),
  repoFullName: varchar('repo_full_name', { length: 200 }),
  productionDomain: varchar('production_domain', { length: 255 }),
  deployState: varchar('deploy_state', { length: 20 }),
  deployCreatedAt: dt('deploy_created_at'),
  deployInspectorUrl: varchar('deploy_inspector_url', { length: 300 }),
  deployCommit: varchar('deploy_commit', { length: 255 }),
  deployError: varchar('deploy_error', { length: 255 }),
  syncedAt: dt('synced_at').notNull(),
  available: boolean('available').notNull().default(true),
})

/** Format 1 status reports (daily, unsigned). */
export const statusReports = mysqlTable('status_reports', {
  kompanie: varchar('kompanie', { length: 150 }).notNull(),
  variant: varchar('variant', { length: 20 }).notNull(),
  version: varchar('version', { length: 30 }).notNull(),
  php: varchar('php', { length: 5 }).notNull(),
  dbDriver: varchar('db_driver', { length: 10 }).notNull(),
  updateOk: boolean('update_ok'),
  updateAt: dt('update_at'),
  updateTo: varchar('update_to', { length: 30 }),
  updateCheckOk: boolean('update_check_ok').notNull(),
  galleryOk: boolean('gallery_ok'),
  galleryAt: dt('gallery_at'),
  sentAt: dt('sent_at'),
  receivedAt: dt('received_at').notNull(),
}, t => [primaryKey({ columns: [t.kompanie, t.variant] })])

export const statusReportHours = mysqlTable('status_report_hours', {
  hour: char('hour', { length: 10 }).primaryKey(),
  received: int('received', { unsigned: true }).notNull(),
})

export const costs = mysqlTable('costs', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 100 }),
  amountCents: int('amount_cents', { unsigned: true }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  billingInterval: varchar('billing_interval', { length: 5 }).notNull(),
  projectId: bigint('project_id', { mode: 'number', unsigned: true }),
  note: varchar('note', { length: 255 }),
  createdAt: dt('created_at').notNull(),
})

export const vercelCharges = mysqlTable('vercel_charges', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  service: varchar('service', { length: 150 }).notNull(),
  category: varchar('category', { length: 20 }).notNull(),
  project: varchar('project', { length: 150 }),
  // DECIMAL arrives as a string; the repository converts it.
  billedCost: decimal('billed_cost', { precision: 14, scale: 6 }).notNull(),
  effectiveCost: decimal('effective_cost', { precision: 14, scale: 6 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
})

export const vercelBilling = mysqlTable('vercel_billing', {
  id: tinyint('id', { unsigned: true }).primaryKey(),
  periodFrom: date('period_from', { mode: 'string' }),
  periodTo: date('period_to', { mode: 'string' }),
  syncedAt: dt('synced_at'),
  error: varchar('error', { length: 255 }),
  errorAt: dt('error_at'),
})

/** Format 2 and 3 status reports: one row per installation. JSON columns are stored as text. */
export const installations = mysqlTable('installations', {
  id: char('id', { length: 32 }).primaryKey(),
  kompanie: varchar('kompanie', { length: 150 }).notNull(),
  variant: varchar('variant', { length: 20 }).notNull(),
  secretEnc: varchar('secret_enc', { length: 255 }).notNull(),
  version: varchar('version', { length: 30 }).notNull(),
  php: varchar('php', { length: 5 }).notNull(),
  dbDriver: varchar('db_driver', { length: 10 }).notNull(),
  cronKind: varchar('cron_kind', { length: 10 }).notNull(),
  cronLast: dt('cron_last'),
  checks: text('checks').notNull(),
  errors: text('errors').notNull(),
  details: text('details'),
  features: varchar('features', { length: 600 }).notNull(),
  updateOk: boolean('update_ok'),
  updateAt: dt('update_at'),
  updateTo: varchar('update_to', { length: 30 }),
  updateCheckOk: boolean('update_check_ok').notNull(),
  galleryOk: boolean('gallery_ok'),
  galleryAt: dt('gallery_at'),
  maintenance: boolean('maintenance').notNull().default(false),
  usageCounts: text('usage_counts'),
  firstSeen: dt('first_seen').notNull(),
  lastSeen: dt('last_seen').notNull(),
  lastHeartbeat: dt('last_heartbeat'),
})

export const statusHeartbeats = mysqlTable('status_heartbeats', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  installationId: char('installation_id', { length: 32 }).notNull(),
  receivedAt: dt('received_at').notNull(),
  version: varchar('version', { length: 30 }).notNull(),
  checks: text('checks').notNull(),
  errors: text('errors').notNull(),
  details: text('details'),
  cronKind: varchar('cron_kind', { length: 10 }).notNull(),
})

export const statusEvents = mysqlTable('status_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  installationId: char('installation_id', { length: 32 }).notNull(),
  code: varchar('code', { length: 40 }).notNull(),
  detail: varchar('detail', { length: 64 }),
  version: varchar('version', { length: 30 }).notNull(),
  receivedAt: dt('received_at').notNull(),
})

export const statusNonces = mysqlTable('status_nonces', {
  installationId: char('installation_id', { length: 32 }).notNull(),
  nonce: char('nonce', { length: 16 }).notNull(),
  receivedAt: dt('received_at').notNull(),
}, t => [primaryKey({ columns: [t.installationId, t.nonce] })])

export const statusUsage = mysqlTable('status_usage', {
  installationId: char('installation_id', { length: 32 }).notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  users: int('users', { unsigned: true }).notNull(),
  d1: int('d1', { unsigned: true }).notNull(),
  d7: int('d7', { unsigned: true }).notNull(),
  d30: int('d30', { unsigned: true }).notNull(),
  areas: text('areas').notNull(),
}, t => [primaryKey({ columns: [t.installationId, t.day] })])

export const alerts = mysqlTable('alerts', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  installationId: char('installation_id', { length: 32 }),
  kompanie: varchar('kompanie', { length: 150 }).notNull(),
  variant: varchar('variant', { length: 20 }),
  alertKey: varchar('alert_key', { length: 60 }).notNull(),
  detail: varchar('detail', { length: 255 }).notNull(),
  openedAt: dt('opened_at').notNull(),
  lastSeenAt: dt('last_seen_at').notNull(),
  notifiedAt: dt('notified_at'),
  resolvedAt: dt('resolved_at'),
  resolvedNotifiedAt: dt('resolved_notified_at'),
})

export const pushSubscriptions = mysqlTable('push_subscriptions', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  userId: int('user_id', { unsigned: true }).notNull(),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  createdAt: dt('created_at').notNull(),
  lastError: varchar('last_error', { length: 255 }),
})

export const reportInstallations = mysqlTable('report_installations', {
  id: char('id', { length: 32 }).primaryKey(),
  kompanie: varchar('kompanie', { length: 150 }).notNull(),
  secretEnc: varchar('secret_enc', { length: 255 }).notNull(),
  firstSeen: dt('first_seen').notNull(),
  lastSeen: dt('last_seen').notNull(),
})

export const bugReports = mysqlTable('bug_reports', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  installationId: char('installation_id', { length: 32 }).notNull(),
  reportId: char('report_id', { length: 32 }).notNull(),
  kompanie: varchar('kompanie', { length: 150 }).notNull(),
  payload: mediumtext('payload').notNull(),
  screenshot: mediumblob('screenshot'),
  screenshotType: varchar('screenshot_type', { length: 20 }),
  screenshotUrl: varchar('screenshot_url', { length: 500 }),
  issueNumber: int('issue_number', { unsigned: true }),
  issueUrl: varchar('issue_url', { length: 500 }),
  attempts: int('attempts', { unsigned: true }).notNull().default(0),
  lastError: varchar('last_error', { length: 255 }),
  receivedAt: dt('received_at').notNull(),
  doneAt: dt('done_at'),
})

export const bugReportCounts = mysqlTable('bug_report_counts', {
  bucket: varchar('bucket', { length: 80 }).notNull(),
  hour: char('hour', { length: 10 }).notNull(),
  received: int('received', { unsigned: true }).notNull(),
}, t => [primaryKey({ columns: [t.bucket, t.hour] })])

export const releaseRuns = mysqlTable('release_runs', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey(),
  /** promote = kern-freigeben.yml, sync = kompanien-abgleichen.yml */
  workflow: varchar('workflow', { length: 10 }).notNull(),
  channel: varchar('channel', { length: 10 }).notNull(),
  branch: varchar('branch', { length: 100 }).notNull(),
  event: varchar('event', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  conclusion: varchar('conclusion', { length: 20 }),
  /** NULL = not known yet, 1 = a publishing job exists, 0 = completed without one. */
  publishing: tinyint('publishing'),
  title: varchar('title', { length: 200 }),
  headSha: char('head_sha', { length: 40 }).notNull(),
  coreVersion: varchar('core_version', { length: 20 }),
  htmlUrl: varchar('html_url', { length: 300 }).notNull(),
  startedAt: dt('started_at').notNull(),
  updatedAt: dt('updated_at').notNull(),
})

export const schemaMigrations = mysqlTable('schema_migrations', {
  version: varchar('version', { length: 64 }).primaryKey(),
  appliedAt: dt('applied_at').notNull(),
})
