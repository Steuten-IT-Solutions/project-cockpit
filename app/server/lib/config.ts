// The cockpit's settings, validated with the same rules as the PHP cockpit's
// src/Config.php. In Nuxt every value comes from an environment variable (see
// .env.example); an optional section is switched off by leaving its main value empty.
// parseConfig() is pure so the rules can be unit tested.

export interface CockpitConfig {
  baseUrl: string
  timezone: string
  /** Empty: the setup page answers 404. */
  setupToken: string
  github: { clientId: string, privateKeyFile: string, accounts: string[], apiBase: string } | null
  vercel: { token: string, teamId: string, apiBase: string, billing: boolean } | null
  statusReports: { org: string } | null
  alerts: { email: string, from: string } | null
  push: { privateKeyFile: string, subject: string } | null
  bugReports: { repo: string, labelPrefix: string, clientId: string | null, privateKeyFile: string | null } | null
  releases: { repo: string, webhookSecret: string | null } | null
  mail: { sendmail: string }
}

/** The shape of runtimeConfig in nuxt.config.ts. Nuxt turns "true"/"false" into booleans. */
export interface RawConfig {
  baseUrl?: string
  timezone?: string
  setupToken?: string
  github?: { clientId?: string, privateKeyFile?: string, accounts?: string, apiBase?: string }
  vercel?: { token?: string, teamId?: string, apiBase?: string, billing?: boolean | string }
  statusReports?: { org?: string }
  alerts?: { email?: string, from?: string }
  push?: { privateKeyFile?: string, subject?: string }
  bugReports?: { repo?: string, labelPrefix?: string, clientId?: string, privateKeyFile?: string }
  releases?: { repo?: string, webhookSecret?: string }
  mail?: { sendmail?: string }
}

const ORIGIN = /^https?:\/\/[^/]+$/
const LOGIN = /^[A-Za-z0-9-]{1,39}$/
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
// A pragmatic check like PHP's FILTER_VALIDATE_EMAIL for the addresses in use.
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

function value(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function required(v: unknown, name: string): string {
  const s = value(v)
  if (s === '' || s.includes('CHANGE-ME')) {
    throw new Error(`Configuration value "${name}" is missing.`)
  }
  return s
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: tz })
    return true
  }
  catch {
    return false
  }
}

export function parseConfig(raw: RawConfig): CockpitConfig {
  const baseUrl = value(raw.baseUrl)
  if (baseUrl !== '' && !ORIGIN.test(baseUrl)) {
    throw new Error('base_url must be an origin without a trailing slash.')
  }
  const timezone = value(raw.timezone) || 'Europe/Berlin'
  if (!validTimezone(timezone)) {
    throw new Error('timezone is not a valid identifier.')
  }
  const setupToken = value(raw.setupToken)
  if (setupToken !== '' && setupToken.length < 32) {
    throw new Error('setup_token must be empty or at least 32 characters long.')
  }

  let github: CockpitConfig['github'] = null
  if (value(raw.github?.clientId) !== '') {
    const accounts = value(raw.github?.accounts).split(',').map(a => a.trim()).filter(a => a !== '')
    if (accounts.length === 0 || !accounts.every(a => LOGIN.test(a))) {
      throw new Error('github.accounts must list GitHub logins, separated by commas.')
    }
    const apiBase = value(raw.github?.apiBase) || 'https://api.github.com'
    if (!ORIGIN.test(apiBase)) {
      throw new Error('github.api_base must be an origin without a trailing slash.')
    }
    github = {
      clientId: required(raw.github?.clientId, 'github.client_id'),
      privateKeyFile: required(raw.github?.privateKeyFile, 'github.private_key_file'),
      accounts,
      apiBase,
    }
  }

  let vercel: CockpitConfig['vercel'] = null
  if (value(raw.vercel?.token) !== '') {
    const teamId = required(raw.vercel?.teamId, 'vercel.team_id')
    if (!/^team_[A-Za-z0-9]+$/.test(teamId)) {
      throw new Error('vercel.team_id must look like team_…')
    }
    const apiBase = value(raw.vercel?.apiBase) || 'https://api.vercel.com'
    if (!ORIGIN.test(apiBase)) {
      throw new Error('vercel.api_base must be an origin without a trailing slash.')
    }
    const billing = raw.vercel?.billing
    vercel = {
      token: required(raw.vercel?.token, 'vercel.token'),
      teamId,
      apiBase,
      billing: billing === undefined || billing === '' || billing === true || billing === 'true',
    }
  }

  let statusReports: CockpitConfig['statusReports'] = null
  if (value(raw.statusReports?.org) !== '') {
    const org = value(raw.statusReports?.org)
    if (!LOGIN.test(org)) {
      throw new Error('status_reports.org must be a GitHub organisation login.')
    }
    statusReports = { org }
  }

  let alerts: CockpitConfig['alerts'] = null
  if (value(raw.alerts?.email) !== '') {
    const email = value(raw.alerts?.email)
    const from = required(raw.alerts?.from, 'alerts.from')
    const fromAddress = /^[^<>\r\n]*<([^<>\r\n]+)>$/.exec(from)?.[1] ?? from
    if (!EMAIL.test(email) || !EMAIL.test(fromAddress) || /[\r\n]/.test(from)) {
      throw new Error('alerts.email and alerts.from must be e-mail addresses.')
    }
    alerts = { email, from }
  }

  let push: CockpitConfig['push'] = null
  if (value(raw.push?.privateKeyFile) !== '') {
    const subject = required(raw.push?.subject, 'push.subject')
    if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) {
      throw new Error('push.subject must be a mailto: or https:// address.')
    }
    push = { privateKeyFile: value(raw.push?.privateKeyFile), subject }
  }

  let bugReports: CockpitConfig['bugReports'] = null
  if (value(raw.bugReports?.repo) !== '') {
    const repo = value(raw.bugReports?.repo)
    if (!REPO.test(repo)) {
      throw new Error('bug_reports.repo must be owner/name.')
    }
    const labelPrefix = value(raw.bugReports?.labelPrefix) || 'kompanie:'
    // eslint-disable-next-line no-control-regex
    if ([...labelPrefix].length > 20 || /[\x00-\x1F,]/.test(labelPrefix)) {
      throw new Error('bug_reports.label_prefix must be a short text without commas.')
    }
    const clientId = value(raw.bugReports?.clientId) || null
    const privateKeyFile = value(raw.bugReports?.privateKeyFile) || null
    if ((clientId === null) !== (privateKeyFile === null)) {
      throw new Error('bug_reports.client_id and bug_reports.private_key_file go together.')
    }
    if (clientId === null && github === null) {
      throw new Error('bug_reports needs the github section or its own client_id and private_key_file.')
    }
    bugReports = { repo, labelPrefix, clientId, privateKeyFile }
  }

  let releases: CockpitConfig['releases'] = null
  if (value(raw.releases?.repo) !== '') {
    const repo = value(raw.releases?.repo)
    if (!REPO.test(repo)) {
      throw new Error('releases.repo must be owner/name.')
    }
    if (github === null) {
      throw new Error('releases needs the github section.')
    }
    const webhookSecret = value(raw.releases?.webhookSecret) || null
    if (webhookSecret !== null && webhookSecret.length < 32) {
      throw new Error('releases.webhook_secret must be at least 32 characters long.')
    }
    releases = { repo, webhookSecret }
  }

  return {
    baseUrl,
    timezone,
    setupToken,
    github,
    vercel,
    statusReports,
    alerts,
    push,
    bugReports,
    releases,
    mail: { sendmail: value(raw.mail?.sendmail) || '/usr/sbin/sendmail' },
  }
}
