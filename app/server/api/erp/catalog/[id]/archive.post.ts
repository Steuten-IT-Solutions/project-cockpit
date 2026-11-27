export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const archived = (await readObject(event)).archived === true
  if (!await erp.master.archiveCatalogItem(idParam(event), archived, erp.now())) refuse('Der Eintrag existiert nicht mehr.')
  return { message: archived ? 'Artikel archiviert.' : 'Artikel wieder aktiv.' }
})
