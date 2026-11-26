export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { master } = useErp(event)
  const [customers, projects] = await Promise.all([master.customers(), master.projects()])
  return { customers, projects }
})
