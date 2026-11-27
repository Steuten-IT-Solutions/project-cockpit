import { readListQuery, writeListQuery } from '#shared/lib/listQuery'

/**
 * Search and filters of a list, kept in the page address (shared/lib/listQuery.ts). Going back
 * from a record restores them, because the browser's history entry holds the address.
 * `router.replace` changes the address without adding a history entry per keystroke.
 */
export function useListState<T extends Record<string, string>>(defaults: T, allowed: Partial<Record<keyof T, readonly string[]>> = {}): T {
  const route = useRoute()
  const router = useRouter()
  const state = reactive(readListQuery(route.query, defaults, allowed)) as T
  watch(() => ({ ...state }), (now) => {
    router.replace({ query: writeListQuery(route.query, now, defaults) })
  })
  return state
}

/**
 * Remembers which record of a list was opened last, so the list scrolls back to it and marks
 * it when you return. Kept in memory for this tab (useState), per list page.
 */
export function useLastOpened(list: string) {
  const last = useState<number | null>(`last-opened:${list}`, () => null)
  onMounted(() => {
    if (last.value === null) return
    // After the page is drawn and the browser has restored its own scroll position: only
    // scroll when the row is not visible anyway.
    requestAnimationFrame(() => {
      const row = document.getElementById(`row-${list}-${last.value}`)
      if (row === null) return
      const box = row.getBoundingClientRect()
      if (box.top < 0 || box.bottom > window.innerHeight) row.scrollIntoView({ block: 'center' })
    })
  })
  return {
    last,
    /** id attribute of a row, so it can be found again. */
    rowId: (id: number) => `row-${list}-${id}`,
    open: (id: number) => { last.value = id },
  }
}
