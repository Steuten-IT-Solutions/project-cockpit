// Puts the session state, which the server middleware prepared for this page
// render, into the shared state before any page or route middleware runs.
export default defineNuxtPlugin(() => {
  if (import.meta.server) {
    const prepared = useRequestEvent()?.context.cockpit
    if (prepared !== undefined) {
      useCockpitSession().value = prepared
    }
  }
})
