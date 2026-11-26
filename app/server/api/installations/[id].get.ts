import { AlertRepository, InstallationRepository } from '../../lib/repositories/status'
import { utc } from '../../lib/time'

/** History is kept this long (src/Status/Alerts.php KEEP_DAYS). */
const KEEP_DAYS = 90

// One installation of a company app: state, alerts, usage figures and history.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  const { db } = useCockpit(event)
  const repository = new InstallationRepository(db)
  const installation = await repository.get(id)
  if (installation === null) {
    throw createError({ statusCode: 404, statusMessage: 'Nicht gefunden' })
  }
  const [history, alerts, usage, usageDays] = await Promise.all([
    repository.history(id, utc(-KEEP_DAYS * 86400), 200),
    new AlertRepository(db).forInstallation(id, 50),
    repository.usage(id),
    repository.usageDays(id, utc(-29 * 86400).slice(0, 10)),
  ])
  return { now: Math.floor(Date.now() / 1000), installation, history, alerts, usage, usageDays }
})
