// Reading untrusted JSON the way the PHP receiver did (json_decode($body, true, $depth)),
// so a report the PHP cockpit refused is refused here too. Differences between PHP and
// JavaScript that matter for validation are handled here:
// - invalid UTF-8 and unpaired surrogate escapes are errors in PHP;
// - PHP limits nesting (depth 8 allows seven nested arrays or objects);
// - PHP turns object keys like "12" into integer keys, which the validators reject;
// - PHP's array_is_list() treats {"0": …, "1": …} as a list.

export class JsonError extends Error {}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Parses like json_decode($body, true, $depth, JSON_THROW_ON_ERROR); throws JsonError. */
export function phpJsonDecode(body: Buffer | string, depth: number): unknown {
  let text: string
  try {
    text = typeof body === 'string' ? body : decoder.decode(body)
  }
  catch {
    throw new JsonError('Malformed UTF-8')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    throw new JsonError('Syntax error')
  }
  check(value, depth - 1)
  return value
}

function check(value: unknown, containersLeft: number): void {
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new JsonError('Single unpaired UTF-16 surrogate')
    return
  }
  if (typeof value !== 'object' || value === null) return
  if (containersLeft <= 0) throw new JsonError('Maximum stack depth exceeded')
  if (Array.isArray(value)) {
    for (const item of value) check(item, containersLeft - 1)
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key.isWellFormed()) throw new JsonError('Single unpaired UTF-16 surrogate')
    check(item, containersLeft - 1)
  }
}

const INT64_MAX = 9223372036854775807n

/** Whether PHP stores this object key as an integer (e.g. "12", "-3", not "012"). */
export function isIntegerKey(key: string): boolean {
  if (!/^(0|-?[1-9]\d*)$/.test(key)) return false
  const n = BigInt(key)
  return n <= INT64_MAX && n >= -INT64_MAX - 1n
}

/** PHP's is_array() of a decoded value: a JSON array or object. */
export function isPhpArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

function listLike(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((k, i) => k === String(i))
}

/** A JSON object with at most `max` entries, as StatusReport::isObject() (an empty array counts). */
export function isPhpObject(value: unknown, max: number): value is Record<string, unknown> {
  if (Array.isArray(value)) return value.length === 0
  if (!isPhpArray(value)) return false
  const size = Object.keys(value).length
  return size <= max && (size === 0 || !listLike(value as Record<string, unknown>))
}

/** The items if PHP sees a list (array_is_list), else null. */
export function phpList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!isPhpArray(value)) return null
  return listLike(value as Record<string, unknown>) ? Object.values(value) : null
}

/** Entries of a JSON object as PHP iterates them: integer-like keys are no strings there. */
export function phpEntries(value: Record<string, unknown>): [string | number, unknown][] {
  return Object.entries(value).map(([k, v]) => [isIntegerKey(k) ? Number(k) : k, v])
}

/** PHP's is_int() for a decoded number (JSON 5.0 is a float in PHP; that difference is accepted). */
export function isPhpInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
