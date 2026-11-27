import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { type Attachment, simpleParser } from 'mailparser'
import type { Pool } from 'mysql2/promise'
import type { IncomingMailFile, MailboxSettings } from '#shared/types/erp'
import type { Crypto } from '../crypto'
import { withLock } from '../lock'
import type { InvoiceEngine } from './engine'
import { incomingType } from './files'
import { IncomingRepository } from './incoming'
import { InvoiceError } from './invoices'
import { exec, one, rows } from './sql'

// Incoming invoices by e-mail. The background jobs fetch the mailbox for incoming invoices
// (e.g. eingangsrechnung@) every 15 minutes. Each usable attachment is kept in
// incoming_mail_files: an e-invoice (ZUGFeRD PDF, CII XML) becomes an incoming invoice at
// once, any other PDF or photo waits there until it is entered by hand on the page
// "Eingangsrechnungen" or ignored. Forwarded mails work too, also when forwarded "as
// attachment". The message itself is never deleted: it moves to the folder
// "Verarbeitet" (or "Ohne Rechnung" if it had no usable attachment) and stays in the mail
// archive, as GoBD asks for received documents.

export const DONE_FOLDER = 'Verarbeitet'
export const NOTHING_FOLDER = 'Ohne Rechnung'
/** Messages per run; the rest follow 15 minutes later. */
const BATCH = 25
const MAX_MESSAGE_BYTES = 30_000_000
const MAX_FILE_BYTES = 7_500_000
/** Smaller images are logos and icons in signatures, not photographed invoices. */
const MIN_IMAGE_BYTES = 50_000

export interface MailboxAccess { host: string, user: string, password: string }

/** An attachment with the message it came in (for a forwarded message: the original one). */
export interface MailFile { name: string, data: Buffer, type: string, sender: string | null, subject: string | null, date: Date | null }

export interface ParsedMail {
  messageId: string | null
  sender: string | null
  subject: string | null
  date: Date | null
  files: MailFile[]
}

/** The usable attachments of a message, including those of messages attached to it. */
export async function parseMail(source: Buffer, depth = 0): Promise<ParsedMail> {
  const mail = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true })
  const from = mail.from?.value[0]
  const meta = {
    messageId: mail.messageId?.slice(0, 255) ?? null,
    sender: from === undefined ? null : (from.name ? `${from.name} <${from.address ?? ''}>` : from.address ?? null)?.slice(0, 255) ?? null,
    subject: mail.subject?.slice(0, 255) ?? null,
    date: mail.date ?? null,
  }
  const files: MailFile[] = []
  for (const attachment of mail.attachments) {
    if (attachment.contentType === 'message/rfc822' && depth < 3) {
      files.push(...(await parseMail(attachment.content, depth + 1)).files)
      continue
    }
    const file = usable(attachment)
    if (file !== null) files.push({ ...file, sender: meta.sender, subject: meta.subject, date: meta.date })
  }
  return { ...meta, files }
}

function usable(attachment: Attachment): Pick<MailFile, 'name' | 'data' | 'type'> | null {
  const data = attachment.content
  if (data.length === 0 || data.length > MAX_FILE_BYTES) return null
  // Recognized by the bytes, not by the name or the sender's content type.
  const type = incomingType(data)
  if (type === null) return null
  if (type.startsWith('image/') && (attachment.contentDisposition !== 'attachment' || data.length < MIN_IMAGE_BYTES)) return null
  const fallback = type === 'application/pdf' ? 'rechnung.pdf' : type === 'application/xml' ? 'rechnung.xml' : 'beleg'
  return { name: (attachment.filename ?? fallback).replace(/[\r\n]/g, ' ').slice(0, 190), data, type }
}

const COLUMNS = `id, sender, subject, received_at AS receivedAt, file_name AS fileName, file_type AS fileType, status,
  incoming_invoice_id AS incomingInvoiceId, problem, created_at AS createdAt`

export class MailFileRepository {
  constructor(private readonly pool: Pool) {}

  /** Files waiting to be entered, oldest first. */
  async waiting(): Promise<IncomingMailFile[]> {
    // A file entered on another way (uploaded by hand) no longer waits, even before settle() ran.
    return rows<IncomingMailFile>(this.pool, `SELECT ${COLUMNS} FROM incoming_mail_files m WHERE status = 'new'
      AND NOT EXISTS (SELECT 1 FROM incoming_invoices i WHERE i.file_sha256 = m.sha256) ORDER BY id`)
  }

  async file(id: number): Promise<{ content: Buffer, name: string, type: string } | null> {
    return one(this.pool, 'SELECT content, file_name AS name, file_type AS type FROM incoming_mail_files WHERE id = ?', [id])
  }

  async ignore(id: number, now: string, reason = 'Von Hand ignoriert.'): Promise<boolean> {
    const result = await exec(this.pool, `UPDATE incoming_mail_files SET status = 'ignored', problem = ?, updated_at = ? WHERE id = ? AND status = 'new'`, [reason.slice(0, 500), now, id])
    return result.affectedRows > 0
  }

  /**
   * Marks waiting files as entered whose very file is already an incoming invoice, e.g.
   * when the same PDF was uploaded by hand instead of via "Erfassen". Returns how many.
   */
  async settle(now: string): Promise<number> {
    const result = await exec(this.pool, `UPDATE incoming_mail_files m JOIN incoming_invoices i ON i.file_sha256 = m.sha256
      SET m.status = 'booked', m.incoming_invoice_id = i.id, m.problem = NULL, m.updated_at = ? WHERE m.status = 'new'`, [now])
    return result.affectedRows
  }

  async booked(id: number, incomingInvoiceId: number, now: string): Promise<void> {
    await exec(this.pool, `UPDATE incoming_mail_files SET status = 'booked', incoming_invoice_id = ?, problem = NULL, updated_at = ? WHERE id = ?`, [incomingInvoiceId, now, id])
  }

  /**
   * Keeps one attachment and enters it if it is an e-invoice. Returns what happened;
   * 'known' if the same file came before (e.g. the same invoice forwarded twice).
   */
  async take(mail: ParsedMail, file: MailFile, engine: InvoiceEngine, now: string): Promise<'booked' | 'new' | 'ignored' | 'known'> {
    const sha = createHash('sha256').update(file.data).digest('hex')
    const received = file.date === null || Number.isNaN(file.date.getTime()) ? null : file.date.toISOString().slice(0, 19).replace('T', ' ')
    const inserted = await exec(this.pool, `INSERT IGNORE INTO incoming_mail_files (message_id, sender, subject, received_at, file_name, file_type, sha256,
      content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [mail.messageId, file.sender, file.subject, received, file.name, file.type, sha, file.data, now, now])
    if (inserted.affectedRows === 0) return 'known'
    const id = inserted.insertId
    if (file.type.startsWith('image/')) {
      await this.settle(now)
      return (await one<{ status: string }>(this.pool, 'SELECT status FROM incoming_mail_files WHERE id = ?', [id]))?.status === 'booked' ? 'ignored' : 'new'
    }
    try {
      const result = await new IncomingRepository(this.pool).upload({ name: file.name, data: file.data }, null, 'other', [], engine, now)
      await this.booked(id, result.id, now)
      if (result.warnings.length > 0) await exec(this.pool, 'UPDATE incoming_mail_files SET problem = ? WHERE id = ?', [result.warnings.join(' ').slice(0, 500), id])
      return 'booked'
    }
    catch (e) {
      if (!(e instanceof InvoiceError)) throw e
      // A plain PDF needs the fields typed in: it waits without a problem.
      if (e.message.includes('keine E-Rechnung')) return 'new'
      const ignored = e.message.includes('bereits erfasst') || file.type === 'application/xml'
      await exec(this.pool, 'UPDATE incoming_mail_files SET status = ?, problem = ?, updated_at = ? WHERE id = ?', [ignored ? 'ignored' : 'new', e.message.slice(0, 500), now, id])
      return ignored ? 'ignored' : 'new'
    }
  }
}

export interface FetchResult { messages: number, booked: number, waiting: number, ignored: number }

/** The fetch summary as shown on the dashboard and after "Jetzt abrufen". */
export function fetchSummary(r: FetchResult): string {
  if (r.messages === 0) return 'Postfach: keine neuen E-Mails'
  return `Postfach: ${r.messages} ${r.messages === 1 ? 'E-Mail' : 'E-Mails'}, ${r.booked} E-Rechnung(en) erfasst, ${r.waiting} Beleg(e) zum Erfassen`
    + (r.ignored > 0 ? `, ${r.ignored} übersprungen` : '')
}

/**
 * Fetches up to BATCH messages from the inbox, keeps their attachments and moves each
 * message away once its attachments are stored. A message whose handling fails stays in
 * the inbox and is tried again next time.
 */
export async function fetchMailbox(access: MailboxAccess, pool: Pool, engine: InvoiceEngine, now: string,
  connect: (access: MailboxAccess) => ImapFlow = imapClient): Promise<FetchResult> {
  const repository = new MailFileRepository(pool)
  const result: FetchResult = { messages: 0, booked: 0, waiting: 0, ignored: 0 }
  await repository.settle(now)
  const client = connect(access)
  await client.connect()
  try {
    for (const folder of [DONE_FOLDER, NOTHING_FOLDER]) {
      if (!(await client.list()).some(m => m.path === folder)) await client.mailboxCreate(folder)
    }
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = (await client.search({ all: true }, { uid: true })) || []
      for (const uid of uids.slice(0, BATCH)) {
        const message = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true })
        if (message === false) continue
        let target = NOTHING_FOLDER
        if (message.source !== undefined && (message.size ?? 0) <= MAX_MESSAGE_BYTES) {
          const mail = await parseMail(message.source)
          for (const file of mail.files) {
            const outcome = await repository.take(mail, file, engine, now)
            if (outcome === 'booked') result.booked++
            else if (outcome === 'new') result.waiting++
            else result.ignored++
          }
          if (mail.files.length > 0) target = DONE_FOLDER
        }
        await client.messageMove(String(uid), target, { uid: true })
        result.messages++
      }
    }
    finally {
      lock.release()
    }
  }
  finally {
    await client.logout().catch(() => client.close())
  }
  return result
}

function imapClient(access: MailboxAccess): ImapFlow {
  return new ImapFlow({ host: access.host, port: 993, secure: true, auth: { user: access.user, pass: access.password }, logger: false })
}

/** Only one fetch at a time (background job and the button "Jetzt abrufen"). */
const LOCK = 'cockpit_mailbox'

export class MailboxSettingsRepository {
  constructor(private readonly pool: Pool, private readonly crypto: Crypto) {}

  async settings(): Promise<MailboxSettings> {
    const row = await one<{ host: string | null, user: string | null, secret: string | null }>(this.pool,
      'SELECT imap_host AS host, imap_user AS user, imap_secret AS secret FROM company_settings WHERE id = 1')
    return { host: row?.host ?? null, user: row?.user ?? null, hasPassword: row?.secret != null }
  }

  /** The access data, or null if not complete. */
  async access(): Promise<MailboxAccess | null> {
    const row = await one<{ host: string | null, user: string | null, secret: string | null }>(this.pool,
      'SELECT imap_host AS host, imap_user AS user, imap_secret AS secret FROM company_settings WHERE id = 1')
    if (!row?.host || !row.user || !row.secret) return null
    return { host: row.host, user: row.user, password: this.crypto.decrypt(row.secret) }
  }

  /**
   * Saves host and user; a password replaces the stored one, null keeps it. Without a
   * user the mailbox is switched off and the password is removed. false if the company
   * data is not saved yet.
   */
  async save(host: string | null, user: string | null, password: string | null, now: string): Promise<boolean> {
    const result = user === null
      ? await exec(this.pool, 'UPDATE company_settings SET imap_host = ?, imap_user = NULL, imap_secret = NULL, updated_at = ? WHERE id = 1', [host, now])
      : password === null
        ? await exec(this.pool, 'UPDATE company_settings SET imap_host = ?, imap_user = ?, updated_at = ? WHERE id = 1', [host, user, now])
        : await exec(this.pool, 'UPDATE company_settings SET imap_host = ?, imap_user = ?, imap_secret = ?, updated_at = ? WHERE id = 1',
            [host, user, this.crypto.encrypt(password), now])
    return result.affectedRows > 0
  }
}

/**
 * One fetch of the mailbox, if it is set up: null if not set up or if a fetch is running.
 * Errors of the connection (wrong password, server unreachable) are thrown in German.
 */
export async function fetchIncomingMail(pool: Pool, crypto: Crypto, engine: InvoiceEngine, now: string,
  connect?: (access: MailboxAccess) => ImapFlow): Promise<FetchResult | null> {
  const access = await new MailboxSettingsRepository(pool, crypto).access()
  if (access === null) return null
  return withLock(pool, LOCK, async () => {
    try {
      return await fetchMailbox(access, pool, engine, now, connect)
    }
    catch (e) {
      const error = e as { authenticationFailed?: boolean, code?: string, message: string }
      if (error.authenticationFailed) throw new InvoiceError(`Anmeldung am Postfach ${access.user} fehlgeschlagen. Bitte prüfe Benutzer und Passwort.`)
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') throw new InvoiceError(`Der Mailserver ${access.host} ist nicht erreichbar.`)
      throw e
    }
  })
}
