import { isEmail } from '#shared/lib/erp'
import { MailboxSettingsRepository } from '../../../lib/erp/mailbox'

// Saves the mailbox for incoming invoices. An empty password keeps the stored one; an
// empty user switches the fetching off.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const body = await readObject(event)
  const text = (key: string, max: number) => typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : ''
  const host = text('host', 190)
  const user = text('user', 190)
  const password = typeof body.password === 'string' && body.password !== '' ? body.password.slice(0, 500) : null
  if (user !== '' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) refuse('Bitte den Namen des Mailservers eintragen, z. B. mail.steuten-it-solutions.de.')
  if (user !== '' && !isEmail(user)) refuse('Der Benutzer ist die E-Mail-Adresse des Postfachs, z. B. eingangsrechnung@steuten-it-solutions.de.')
  const repository = new MailboxSettingsRepository(erp.pool, erp.crypto)
  if (user !== '' && password === null && !(await repository.settings()).hasPassword) refuse('Bitte das Passwort des Postfachs eintragen.')
  if (!await repository.save(host || null, user || null, user === '' ? null : password, erp.now())) refuse('Bitte speichere zuerst die Firmendaten.')
  return { message: user === '' ? 'Abruf des Postfachs ausgeschaltet.' : 'Postfach gespeichert. Es wird alle 15 Minuten abgerufen.' }
})
