/**
 * Runs a button's request: marks it busy, shows the server's message (or error) as a
 * toast and returns the answer, or null if it failed.
 */
export function useAction() {
  const busy = ref<string | null>(null)
  const notice = useNotice()
  async function run<T>(key: string, request: () => Promise<T>): Promise<T | null> {
    busy.value = key
    try {
      const result = await request()
      const message = (result as { message?: unknown } | null)?.message
      if (typeof message === 'string') notice.ok(message)
      return result
    }
    catch (e) {
      notice.fail(e)
      return null
    }
    finally {
      busy.value = null
    }
  }
  return { busy, run }
}
