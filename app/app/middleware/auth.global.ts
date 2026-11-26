// Every page needs a login, except the two login steps.
export default defineNuxtRouteMiddleware(async (to) => {
  const state = useCockpitSession()
  const session = state.value ?? await refreshCockpitSession()

  if (to.path === '/login') {
    return session.user !== null ? navigateTo('/') : undefined
  }
  if (to.path === '/login/code') {
    if (session.user !== null) {
      return navigateTo('/')
    }
    return session.pending ? undefined : navigateTo('/login')
  }
  if (session.user === null) {
    return navigateTo('/login')
  }
})
