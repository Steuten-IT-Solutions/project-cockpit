export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  await erp.master.setLogo(null, erp.now())
  return { message: 'Logo entfernt.' }
})
