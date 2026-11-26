export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { master } = useErp(event)
  const [catalog, settings] = await Promise.all([master.catalog(), master.settings()])
  return { catalog, smallBusiness: settings?.smallBusiness ?? true }
})
