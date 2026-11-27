import { describe, expect, it } from 'vitest'
import { readListQuery, writeListQuery } from '../../shared/lib/listQuery'

describe('list filters in the address', () => {
  const defaults = { query: '', status: 'open', kind: 'all' }
  const allowed = { status: ['all', 'open', 'paid'], kind: ['all', 'invoice', 'credit'] } as const

  it('reads known values and ignores missing, repeated or unknown ones', () => {
    expect(readListQuery({}, defaults, allowed)).toEqual(defaults)
    expect(readListQuery({ query: 'anthropic', status: 'paid' }, defaults, allowed)).toEqual({ query: 'anthropic', status: 'paid', kind: 'all' })
    expect(readListQuery({ status: 'gone', kind: ['credit', 'invoice'] }, defaults, allowed)).toEqual(defaults)
  })

  it('writes only what differs from the default and keeps other parameters', () => {
    expect(writeListQuery({}, defaults, defaults)).toEqual({})
    expect(writeListQuery({ tab: 'x', status: 'paid' }, { ...defaults, query: 'müller' }, defaults)).toEqual({ tab: 'x', query: 'müller' })
  })

  it('round-trips', () => {
    const state = { query: 'h 2026', status: 'all', kind: 'credit' }
    expect(readListQuery(writeListQuery({}, state, defaults), defaults, allowed)).toEqual(state)
  })
})
