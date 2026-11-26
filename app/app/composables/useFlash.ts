/**
 * The one-time message the server handed to this page (e.g. after logging in with a
 * recovery code). Read once; later pages do not show it again.
 */
export function useFlash() {
  const session = useCockpitSession()
  const flash = ref(session.value?.flash ?? null)
  if (session.value !== null) {
    session.value.flash = null
  }
  return flash
}

/** Shows the server's answer to an action as a short message at the screen's edge. */
export function useNotice() {
  const toast = useToast()
  return {
    ok: (title: string) => toast.add({ title, color: 'success', icon: 'i-lucide-check' }),
    fail: (error: unknown) => toast.add({ title: errorMessage(error), color: 'error', icon: 'i-lucide-triangle-alert' }),
  }
}
