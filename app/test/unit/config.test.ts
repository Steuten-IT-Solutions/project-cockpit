import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../server/lib/config'

// The same rules as src/Config.php; an empty main value switches a section off.

describe('parseConfig', () => {
  it('switches every optional section off by default', () => {
    const config = parseConfig({})
    expect(config.timezone).toBe('Europe/Berlin')
    expect([config.github, config.vercel, config.statusReports, config.alerts, config.push, config.bugReports, config.releases]).toEqual([null, null, null, null, null, null, null])
    expect(config.mail.sendmail).toBe('/usr/sbin/sendmail')
  })

  it('reads the sections', () => {
    const config = parseConfig({
      github: { clientId: 'Iv23abc', privateKeyFile: '/etc/cockpit/github-app.pem', accounts: 'Steuten-IT-Solutions, ChrisSteuten' },
      vercel: { token: 'secret', teamId: 'team_abc123', billing: false },
      releases: { repo: 'Steuten-IT-Solutions/Kompanie-App-Template', webhookSecret: 'x'.repeat(32) },
      bugReports: { repo: 'Steuten-IT-Solutions/kompanie-meldungen' },
      alerts: { email: 'ops@example.org', from: 'Cockpit <noreply@example.org>' },
      push: { privateKeyFile: '/etc/cockpit/vapid.pem', subject: 'mailto:ops@example.org' },
    })
    expect(config.github?.accounts).toEqual(['Steuten-IT-Solutions', 'ChrisSteuten'])
    expect(config.github?.apiBase).toBe('https://api.github.com')
    expect(config.vercel?.billing).toBe(false)
    expect(config.bugReports?.labelPrefix).toBe('kompanie:')
    expect(config.releases?.webhookSecret).toHaveLength(32)
  })

  it('rejects what the PHP cockpit rejects', () => {
    expect(() => parseConfig({ timezone: 'Mars/Olympus' })).toThrow('timezone')
    expect(() => parseConfig({ setupToken: 'short' })).toThrow('setup_token')
    expect(() => parseConfig({ vercel: { token: 't', teamId: 'abc' } })).toThrow('team_')
    expect(() => parseConfig({ releases: { repo: 'a/b' } })).toThrow('github section')
    expect(() => parseConfig({ alerts: { email: 'ops@example.org', from: 'nobody' } })).toThrow('e-mail')
    expect(() => parseConfig({ github: { clientId: 'x', privateKeyFile: 'y', accounts: 'bad login!' } })).toThrow('accounts')
  })
})
