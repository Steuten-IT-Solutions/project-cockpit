// What the page needs to write a new quote or order.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { ...await editorData(event), today: useErp(event).today() }
})
