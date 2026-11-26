import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GitHubClient, type HttpTransport } from '../../server/lib/github/client'
import { body, fromPayload, label, strictBase64, title } from '../../server/lib/reports/bugReport'
import { imageSize } from '../../server/lib/reports/image'
import { BugReportSync, type BugReportStore } from '../../server/lib/reports/sync'
import type { PendingReport } from '../../server/lib/repositories/bugReports'

// Bug reports: validation and issue text compared with output of the PHP cockpit
// (fixtures/bug-report.json was written by src/Reports/BugReport.php), and the sync
// ported from tests/Unit/BugReportTest.php.

interface PhpResult {
  installation: string
  kompanie: string
  sent: number
  nonce: string
  key: string | null
  report_id: string
  fields: Record<string, unknown>
  screenshot: string | null
  screenshot_type: string | null
}
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/bug-report.json'), 'utf8')) as {
  fields: Parameters<typeof body>[0]
  fieldsSummer: Parameters<typeof body>[0]
  body: string
  bodySummer: string
  titles: [string, string][]
  labels: [string, string, string][]
  payloads: { name: string, input: unknown, result: PhpResult | null }[]
}
const NOW = 1792368000
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADElEQVQImWNgIAoAAAAnAAGfWjwcAAAAAElFTkSuQmCC'

describe('bug report text', () => {
  it('renders the issue body exactly like PHP', () => {
    expect(body(fixture.fields, 'Steuten-IT-Solutions/kompanie-musterstadt', '0123456789abcdef0123456789abcdef', 'r1', 'https://github.com/o/r/blob/main/screenshots/2026/10/r1.png', 'Europe/Berlin')).toBe(fixture.body)
    // Summer time, a backtick in a cell and Unicode spaces.
    expect(body(fixture.fieldsSummer, 'O/k', 'i', 'r', null, 'Europe/Berlin')).toBe(fixture.bodySummer)
  })

  it('shortens titles and builds labels like PHP', () => {
    for (const [input, expected] of fixture.titles) expect(title(input)).toBe(expected)
    for (const [prefix, kompanie, expected] of fixture.labels) expect(label(prefix, kompanie)).toBe(expected)
  })
})

describe('bug report validation', () => {
  for (const c of fixture.payloads) {
    it(`agrees with PHP: ${c.name}`, () => {
      const result = fromPayload(c.input, 'Steuten-IT-Solutions', NOW)
      if (c.result === null) {
        expect(result).toBeNull()
        return
      }
      expect(result).not.toBeNull()
      expect({
        installation: result!.installation, kompanie: result!.kompanie, sent: result!.sent, nonce: result!.nonce, key: result!.key,
        report_id: result!.reportId, fields: result!.fields, screenshot: result!.screenshot?.toString('base64') ?? null, screenshot_type: result!.screenshotType,
      }).toEqual(c.result)
    })
  }

  it('rejects text PHP cannot decode', () => {
    const input = (fixture.payloads[0]!.input as { report: Record<string, unknown> })
    expect(fromPayload({ ...(input as object), report: { ...input.report, description: 'a\uD800b' } }, 'Steuten-IT-Solutions', NOW)).toBeNull()
  })

  it('decodes base64 strictly like PHP', () => {
    expect(strictBase64('aGVs bG8=')?.toString()).toBe('hello')
    expect(strictBase64('aGVsbG8')?.toString()).toBe('hello')
    expect(strictBase64('aGV=sbG8')).toBeNull()
    expect(strictBase64('aGVsbG8*')).toBeNull()
  })

  it('reads image sizes like getimagesizefromstring()', () => {
    // Written by PHP's GD; sizes as getimagesizefromstring() reported them.
    const images: [string, string, number, number][] = [
      [PNG, 'image/png', 4, 3],
      ['/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgABwAFAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A+f6KKKAP/9k=', 'image/jpeg', 5, 7],
      ['UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoJAAYAAUAmJaQAA3AA/v02aAA=', 'image/webp', 9, 6],
      ['UklGRhoAAABXRUJQVlA4TA4AAAAvCgADAAcQEf0PRET/Aw==', 'image/webp', 11, 13],
    ]
    for (const [data, mime, width, height] of images) {
      expect(imageSize(Buffer.from(data, 'base64'))).toEqual({ mime, width, height })
    }
    expect(imageSize(Buffer.from('kein Bild'))).toBeNull()
  })
})

describe('bug report sync', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  /** In memory, with the same rules as BugReportRepository. */
  class MemoryReports implements BugReportStore {
    rows: (PendingReport & { done: boolean, lastError: string | null })[] = []
    add(kompanie: string, fields: Record<string, unknown>, screenshot: Buffer | null) {
      this.rows.push({
        id: this.rows.length + 1, installationId: 'i'.repeat(32), reportId: String(this.rows.length + 1).repeat(32).slice(0, 32).replace(/\d/g, 'a'),
        kompanie, payload: JSON.stringify(fields), screenshot, screenshotType: screenshot === null ? null : 'image/png',
        screenshotUrl: null, attempts: 0, done: false, lastError: null,
      })
    }

    async pending(limit: number) {
      return this.rows.filter(r => !r.done).slice(0, limit)
    }

    async screenshotCommitted(id: number, url: string) {
      Object.assign(this.rows[id - 1]!, { screenshotUrl: url, screenshot: null })
    }

    async done(id: number) {
      Object.assign(this.rows[id - 1]!, { done: true, payload: '{}', screenshot: null })
    }

    async failed(id: number, error: string) {
      const row = this.rows[id - 1]!
      row.attempts++
      row.lastError = error
    }
  }

  const fields = (o: Record<string, unknown> = {}) => ({
    description: 'Der Knopf geht nicht\nZweite Zeile', expected: 'Dass er geht', page: '#/termine/verwalten', version: '1.4.0.3',
    variant: 'standalone', userAgent: 'Mozilla/5.0 (Test)', role: 'Mitglied', name: null, lastError: 'Fehler 500 (HTTP 500)', created: NOW - 60, ...o,
  })
  const unlocked = <T>(job: () => Promise<T>) => job()

  it('creates label, screenshot and issue with a scoped token', async () => {
    const store = new MemoryReports()
    store.add('Steuten-IT-Solutions/kompanie-musterstadt', fields({ name: 'Max' }), Buffer.from(PNG, 'base64'))
    store.add('Steuten-IT-Solutions/kompanie-musterstadt', fields(), null)
    const calls: [string, string, string][] = []
    const transport: HttpTransport = async (method, url, _headers, requestBody = '') => {
      const path = url.replace('https://api.github.com', '')
      calls.push([method, path, requestBody])
      const answer = (status: number, json: unknown) => ({ status, headers: {}, body: JSON.stringify(json) })
      if (method === 'GET' && path === '/app/installations?per_page=100') return answer(200, [{ id: 5, account: { login: 'Steuten-IT-Solutions' } }])
      if (path === '/app/installations/5/access_tokens') return answer(201, { token: 'ghs_reports' })
      if (method === 'GET' && path.includes('/labels/')) return answer(404, { message: 'Not Found' })
      if (method === 'POST' && path.endsWith('/labels')) return answer(201, {})
      if (method === 'PUT' && path.includes('/contents/screenshots/')) {
        return answer(201, { content: { html_url: `https://github.com/Steuten-IT-Solutions/kompanie-meldungen/blob/main/${path.slice(path.indexOf('screenshots/'))}` } })
      }
      if (method === 'POST' && path.endsWith('/issues')) return answer(201, { number: calls.length, html_url: `https://github.com/x/issues/${calls.length}` })
      return answer(500, {})
    }
    const sync = new BugReportSync(new GitHubClient('Iv23test', PEM, 'https://api.github.com', transport), store, unlocked, 'Steuten-IT-Solutions/kompanie-meldungen', 'kompanie:', 'Europe/Berlin')

    expect(await sync.run(NOW)).toEqual({ created: 2, failed: 0, errors: [] })
    const scope = JSON.parse(calls[1]![2])
    expect(scope.repositories).toEqual(['kompanie-meldungen'])
    expect(scope.permissions.issues).toBe('write')
    expect(calls.filter(c => c[0] === 'POST' && c[1].endsWith('/labels'))).toHaveLength(1)
    const put = calls.filter(c => c[0] === 'PUT')
    expect(put).toHaveLength(1)
    expect(put[0]![1]).toMatch(/\/repos\/Steuten-IT-Solutions\/kompanie-meldungen\/contents\/screenshots\/2026\/10\/[0-9a-f]{32}\.png$/)
    expect(JSON.parse(put[0]![2]).content).toBe(PNG)
    const issue = JSON.parse(calls.find(c => c[1].endsWith('/issues'))![2])
    expect(issue.title).toBe('Der Knopf geht nicht')
    expect(issue.labels).toEqual(['kompanie:kompanie-musterstadt'])
    expect(issue.body).toContain('| Name | ` Max ` |')
    expect(issue.body).toContain('?raw=true')
    expect(await store.pending(10)).toEqual([])
    expect(await sync.run(NOW)).toEqual({ created: 0, failed: 0, errors: [] })
  })

  it('keeps reports when GitHub fails and stops after a server error', async () => {
    const store = new MemoryReports()
    store.add('Steuten-IT-Solutions/kompanie-musterstadt', fields(), null)
    store.add('Steuten-IT-Solutions/kompanie-musterstadt', fields(), null)
    let issues = 0
    const transport: HttpTransport = async (_method, url) => {
      const answer = (status: number, json: unknown) => ({ status, headers: {}, body: JSON.stringify(json) })
      if (url.endsWith('/app/installations?per_page=100')) return answer(200, [{ id: 5, account: { login: 'steuten-it-solutions' } }])
      if (url.endsWith('/access_tokens')) return answer(201, { token: 't' })
      if (url.includes('/labels/')) return answer(200, {})
      issues++
      return answer(502, { message: 'Bad Gateway' })
    }
    const sync = new BugReportSync(new GitHubClient('Iv23test', PEM, 'https://api.github.com', transport), store, unlocked, 'Steuten-IT-Solutions/kompanie-meldungen', 'kompanie:', 'Europe/Berlin')
    const result = await sync.run(NOW)
    expect(result.created).toBe(0)
    expect(issues).toBe(1)
    expect(result.errors[0]).toBe('Issue: GitHub antwortete 502: Bad Gateway')
    expect(await store.pending(10)).toHaveLength(2)
    expect(store.rows[0]!.attempts).toBe(1)

    // Another run holds the lock: nothing happens.
    const locked = new BugReportSync(new GitHubClient('Iv23test', PEM, 'https://api.github.com', transport), store, async () => null, 'Steuten-IT-Solutions/kompanie-meldungen', 'kompanie:', 'Europe/Berlin')
    expect(await locked.run(NOW)).toEqual({ created: 0, failed: 0, errors: [] })
  })
})
