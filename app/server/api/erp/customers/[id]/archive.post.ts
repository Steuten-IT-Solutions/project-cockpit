export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const archived = (await readObject(event)).archived === true
  if (!await erp.master.archiveCustomer(idParam(event), archived, erp.now())) refuse('Der Kunde existiert nicht mehr.')
  return { message: archived ? 'Kunde archiviert.' : 'Kunde wieder aktiv.' }
})
