import { describe, expect, it } from 'vitest'
import { costFromForm, costToForm, costTotals, money, parseAmount } from '../../shared/lib/costs'
import { age, localTime, versionCompare } from '../../shared/lib/format'
import { ciBadge, vercelBadge } from '../../shared/lib/projects'
import { releaseSummary } from '../../shared/lib/releases'
import { alertLabel, causes, light, newerRelease, reportProblems, usageAreas } from '../../shared/lib/status'
import type { ReleaseRun, StatusReport } from '../../shared/types/cockpit'

// Expected values were produced by the PHP cockpit (php -r with src/…), so both
// cockpits show exactly the same.

describe('versionCompare matches PHP version_compare()', () => {
  const cases: [string, string, number][] = [
    ['1.2.3', '1.2.3', 0], ['1.10', '1.9', 1], ['0.1.1', '0.1.1-beta', 1], ['1.0', '1.0.0', -1], ['1.0.0', '1.0', 1],
    ['2.0rc1', '2.0', -1], ['2.0', '2.0pl1', -1], ['1.0-dev', '1.0alpha', -1], ['0.2', '0.1.9', 1], ['1.0a', '1.0b', -1],
    ['1.0.1', '1.0.x', 1], ['1.0', '1.0.foo', 1],
  ]
  it.each(cases)('%s vs %s', (a, b, expected) => {
    expect(versionCompare(a, b)).toBe(expected)
  })
})

describe('costs like src/Costs/Cost.php', () => {
  const amounts: [string, number | null][] = [
    ['12,99', 1299], ['12.99', 1299], ['1.200,50', 120050], ['1200', 120000], ['1 200', 120000], ['12,9', 1290],
    ['abc', null], ['12,999', null], ['1.2.3', null], ['9999999', 999999900], ['10000000', null],
  ]
  it.each(amounts)('parseAmount(%s)', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })

  const monies: [number, string, string][] = [
    [123456, 'EUR', '1.234,56 €'], [99, 'USD', '0,99 US$'], [100000000, 'EUR', '1.000.000,00 €'],
    [1234.5, 'CHF', '12,35 CHF'], [0.5, 'EUR', '0,01 €'],
  ]
  it.each(monies)('money(%s, %s)', (cents, currency, expected) => {
    expect(money(cents, currency)).toBe(expected)
  })

  it('validates the form and converts it back', () => {
    expect(costFromForm({ name: '', amount: '1' }, [])).toBe('Bitte einen Namen eingeben.')
    expect(costFromForm({ name: 'Server', amount: '1', currency: 'EUR', interval: 'month', project: '7' }, [1])).toBe('Unbekanntes Projekt.')
    const cost = costFromForm({ name: ' Strato\tVPS ', provider: '', amount: '1.200,50', currency: 'EUR', interval: 'year', project: '1', note: '' }, [1])
    expect(cost).toEqual({ name: 'Strato VPS', provider: null, amountCents: 120050, currency: 'EUR', billingInterval: 'year', projectId: 1, note: null })
    expect(costToForm(cost as Exclude<typeof cost, string>).amount).toBe('1200,50')
  })

  it('totals per currency', () => {
    expect(costTotals([
      { amountCents: 1200, currency: 'EUR', billingInterval: 'month' },
      { amountCents: 12000, currency: 'EUR', billingInterval: 'year' },
      { amountCents: 500, currency: 'USD', billingInterval: 'month' },
    ])).toEqual({ EUR: { month: 2200, year: 26400 }, USD: { month: 500, year: 6000 } })
  })
})

describe('times like ProjectView::age() and View::localTime()', () => {
  const now = Date.parse('2026-11-26T12:00:00Z') / 1000
  const ages: [string, string][] = [
    ['2026-11-26 11:59:30', 'vor 1 Min.'], ['2026-11-26 11:00:00', 'vor 1 Std.'], ['2026-11-25 13:00:00', 'vor 23 Std.'],
    ['2026-11-25 11:00:00', 'gestern'], ['2026-10-01 12:00:00', 'vor 56 Tagen'], ['2025-01-01 00:00:00', 'vor 23 Monaten'],
    ['2020-01-01 00:00:00', 'vor 6 Jahren'],
  ]
  it.each(ages)('age(%s)', (utc, expected) => {
    expect(age(utc, now)).toBe(expected)
  })

  const times: [string, string][] = [
    ['2026-11-26 15:05:00', '26.11.2026 16:05'], ['2026-07-01 22:30:00', '02.07.2026 00:30'], ['2026-03-29 01:30:00', '29.03.2026 03:30'],
  ]
  it.each(times)('localTime(%s)', (utc, expected) => {
    expect(localTime(utc, 'Europe/Berlin')).toBe(expected)
  })

  it('shows a dash for missing values', () => {
    expect(localTime(null, 'Europe/Berlin')).toBe('–')
    expect(age(null, now)).toBe('–')
  })
})

describe('labels', () => {
  it('CI and Vercel badges', () => {
    expect(ciBadge(null, null)).toEqual(['keine CI', 'neutral'])
    expect(ciBadge('in_progress', null)).toEqual(['CI läuft', 'neutral'])
    expect(ciBadge('completed', 'timed_out')).toEqual(['CI rot', 'fail'])
    expect(ciBadge('completed', 'action_required')).toEqual(['CI action_required', 'warn'])
    expect(vercelBadge('READY')).toEqual(['Vercel live', 'ok'])
    expect(vercelBadge('DELETED')).toEqual(['Vercel deleted', 'warn'])
  })

  it('status rules', () => {
    const now = Date.parse('2026-11-26T12:00:00Z') / 1000
    const report: StatusReport = {
      kompanie: 'Org/kompanie-a', variant: 'standalone', version: '0.1.0', php: '8.3', dbDriver: 'mysql', updateOk: false, updateAt: null,
      updateTo: '0.1.1', updateCheckOk: false, galleryOk: false, galleryAt: null, sentAt: null, receivedAt: '2026-11-20 00:00:00',
    }
    expect(reportProblems(report, now)).toEqual([
      'seit über 3 Tagen keine Meldung', 'Update-Liste nicht erreichbar', 'letztes Update auf 0.1.1 gescheitert', 'Galerie-Abgleich mit Fehler',
    ])
    expect(newerRelease('0.1.0', 'v0.1.1')).toBe('v0.1.1')
    expect(newerRelease('0.1.1', 'v0.1.1')).toBeNull()
    expect(newerRelease('0.1.1', 'nightly')).toBeNull()
    expect(light({ checks: { gallery: 'warn' }, errors: {}, maintenance: false }, false)).toBe('warn')
    expect(light({ checks: {}, errors: {}, maintenance: true }, true)).toBe('maintenance')
    expect(alertLabel('check:gallery')).toBe('Ampel rot: Galerie')
    expect(alertLabel('release:0.2.0')).toBe('Fehlerhäufung nach Release 0.2.0')
    expect(causes({ ics_timeout: 1, ics_http_404: 2, a: 1 })).toBe('ics_http_404: 2, a: 1, ics_timeout: 1')
    expect(usageAreas({ news: 3, app: 10, gallery: 10 })).toEqual([
      { label: 'Allgemein', people: '10' }, { label: 'Galerie', people: '10' }, { label: 'News', people: '< 5' },
    ])
  })

  it('release summary per channel', () => {
    const run = (id: number, channel: string, status: string, conclusion: string | null): ReleaseRun => ({
      id, workflow: 'promote', channel, branch: 'main', event: 'push', status, conclusion, publishing: 1, title: null,
      headSha: 'a'.repeat(40), htmlUrl: `https://example.org/${id}`, startedAt: '2026-11-26 10:00:00', updatedAt: '2026-11-26 10:00:00', coreVersion: '0.1.0',
    })
    const summary = releaseSummary([run(4, 'early', 'in_progress', null), run(3, 'early', 'completed', 'failure'), run(2, 'early', 'completed', 'success'), run(1, 'early', 'completed', 'failure')])
    expect(summary.early!.running.map(r => r.id)).toEqual([4])
    expect(summary.early!.failed?.id).toBe(3)
    expect(summary.early!.last?.id).toBe(2)
    expect(summary.stable).toEqual({ running: [], last: null, failed: null })
  })
})

describe('costs page and installation chart', async () => {
  const { chargeSummary, moneyList } = await import('../../shared/lib/costs')
  const { usageBars } = await import('../../shared/lib/status')

  it('sums Vercel charges', () => {
    const s = chargeSummary([
      { service: 'Functions', category: 'Usage', project: 'a', billedCost: 1.5, effectiveCost: 1.5, currency: 'USD' },
      { service: 'Pro', category: 'Purchase', project: null, billedCost: 20, effectiveCost: 20, currency: 'USD' },
      { service: 'Functions', category: 'Usage', project: 'b', billedCost: 0.001, effectiveCost: 0, currency: 'USD' },
    ])
    expect(moneyList(s.total)).toBe('21,50 US$')
    expect(s.byCategory.map(([k]) => k)).toEqual(['Purchase', 'Usage'])
    expect(s.byProject.map(([k]) => k)).toEqual(['a'])
  })

  it('draws one bar per day, small figures as 5', () => {
    const bars = usageBars([{ day: '2026-11-25', d1: 2 }, { day: '2026-11-26', d1: 10 }, { day: '2026-10-01', d1: 3 }], '2026-11-26')
    expect(bars).toEqual([
      { x: 281, y: 31, width: 8, height: 29, title: '25.11.2026: < 5' },
      { x: 291, y: 2, width: 8, height: 58, title: '26.11.2026: 10' },
    ])
  })
})
