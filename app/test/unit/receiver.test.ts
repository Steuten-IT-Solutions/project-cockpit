import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonError, phpJsonDecode } from '../../server/lib/json'
import { MAX_BODY, Receiver, sign } from '../../server/lib/status/receiver'
import { fromFormat2, fromPayload } from '../../server/lib/status/report'
import { Crypto } from '../../server/lib/crypto'

// The status report validation compared with the PHP cockpit: fixtures/status-report.json
// holds each test payload as JSON and what src/Status/StatusReport.php made of it (cases from
// tests/Unit/StatusReportTest.php and StatusFormat2Test.php plus a few PHP-specific ones).

const NOW = 1792368000
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/status-report.json'), 'utf8')) as
  { name: string, format: 1 | 2, json: string, result: Record<string, unknown> | null }[]

/** The PHP row with snake_case keys, as the TypeScript validator's camelCase result. */
function camel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]))
}

/** PHP's json_encode writes an empty array as [] where the validator returns {}. */
function emptyAsObject(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return {}
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, emptyAsObject(v)]))
  }
  return value
}

describe('status report validation', () => {
  for (const c of fixture) {
    it(`agrees with PHP: ${c.name}`, () => {
      const input = phpJsonDecode(c.json, 8)
      const result = c.format === 1 ? fromPayload(input, 'Steuten-IT-Solutions', NOW) : fromFormat2(input, 'Steuten-IT-Solutions', NOW)
      if (c.result === null) {
        expect(result).toBeNull()
        return
      }
      const expected = camel(c.result)
      // PHP names it db_driver like the column; features stay a list.
      expect(emptyAsObject(result)).toEqual({ ...(emptyAsObject(expected) as object), ...(Array.isArray(expected.features) ? { features: expected.features } : {}) })
    })
  }
})

describe('json like PHP', () => {
  it('limits nesting like json_decode with depth 8', () => {
    expect(phpJsonDecode('[[[[[[[1]]]]]]]', 8)).toEqual([[[[[[[1]]]]]]])
    expect(() => phpJsonDecode('[[[[[[[[1]]]]]]]]', 8)).toThrow(JsonError)
    expect(() => phpJsonDecode('[[[[[[[[]]]]]]]]', 8)).toThrow(JsonError)
    expect(phpJsonDecode('1', 8)).toBe(1)
  })

  it('refuses what PHP cannot decode', () => {
    expect(() => phpJsonDecode(Buffer.from([0x22, 0xFF, 0xFE, 0x22]), 8)).toThrow(JsonError)
    expect(() => phpJsonDecode('"\\ud800"', 8)).toThrow(JsonError)
    expect(() => phpJsonDecode('', 8)).toThrow(JsonError)
    expect(() => phpJsonDecode('{"format":', 8)).toThrow(JsonError)
  })
})

describe('status receiver', () => {
  const crypto = new Crypto(Buffer.alloc(32, 'k'))
  const never = () => {
    throw new Error('The database must not be opened.')
  }
  const receiver = new Receiver(never, 'Steuten-IT-Solutions', never, crypto)
  const send = (method: string, path: string, body: string) => receiver.handle(method, path, Buffer.from(body), NOW)

  it('rejects junk without touching the database', async () => {
    expect((await send('GET', '/', '')).status).toBe(404)
    expect((await send('POST', '/other', '{}')).status).toBe(404)
    expect((await send('POST', '/', ' '.repeat(MAX_BODY + 1))).status).toBe(413)
    expect((await send('POST', '/', '{"format":')).status).toBe(400)
    expect((await send('POST', '/', `${'['.repeat(20)}${']'.repeat(20)}`)).status).toBe(400)
    expect(await send('POST', '/', JSON.stringify({ format: 1, kompanie: 'Other/x', version: '1.4.0.3', variant: 'standalone' }))).toEqual({ status: 400, body: { error: 'invalid' } })
    expect(await send('POST', '/', JSON.stringify({ format: 2 }))).toEqual({ status: 400, body: { error: 'invalid', code: 'invalid' } })
  })

  it('signs like PHP\'s hash_hmac with the hex text as key', () => {
    // php -r 'echo hash_hmac("sha256", "{\"a\":1}", str_repeat("a", 64));'
    expect(sign('{"a":1}', 'a'.repeat(64))).toBe('sha256=5a883d3d53e8864e56e1456a35d06e87aace1c5d61703e0a8bb4b38316324791')
  })
})
