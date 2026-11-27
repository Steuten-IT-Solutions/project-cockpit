import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { isoDate, linesFromForm, today } from '#shared/lib/erp'
import { InvoiceEngine } from '../lib/erp/engine'
import { headFromBody, subscriptionFromBody, timeFromBody, type TimeInput } from '../lib/erp/forms'
import { type DraftInput, InvoiceError } from '../lib/erp/invoices'
import type { SalesInput, SalesKind } from '../lib/erp/sales'
import { TimeRepository } from '../lib/erp/timeEntries'
import { sendmailSender } from '../lib/erp/mail'
import { MasterData } from '../lib/erp/masterData'
import { utc } from '../lib/time'

// Shared services of the ERP routes (server/api/erp). Auto-imported by Nuxt.

let engine: { key: string, instance: InvoiceEngine } | undefined

/** The e-invoice engine; also used by the background jobs, which have no request. */
export function erpEngine(event?: H3Event): InvoiceEngine {
  const runtime = useRuntimeConfig(event)
  // On the server the app runs in <app>/node, so the PHP code (bin/, vendor/) is one level up.
  const phpDir = runtime.erp.phpDir !== '' ? runtime.erp.phpDir : resolve(process.cwd(), '..')
  const phpBinary = runtime.erp.phpBinary !== '' ? runtime.erp.phpBinary : 'php'
  if (engine?.key !== `${phpBinary}\n${phpDir}`) {
    engine = { key: `${phpBinary}\n${phpDir}`, instance: new InvoiceEngine(phpBinary, phpDir) }
  }
  return engine.instance
}

export function useErp(event: H3Event) {
  const { pool, config, crypto } = useCockpit(event)
  return {
    pool,
    config,
    crypto,
    master: new MasterData(pool),
    engine: erpEngine(event),
    mail: sendmailSender(config.mail.sendmail),
    /** Today in the cockpit's time zone (invoice dates are local days). */
    today: () => today(config.timezone),
    now: () => utc(),
  }
}

/** Answers 422 with the German message. */
export function refuse(message: string): never {
  throw createError({ statusCode: 422, statusMessage: message })
}

/** Turns an InvoiceError into a 422 answer; everything else stays a 500. */
export async function erpAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  }
  catch (e) {
    if (e instanceof InvoiceError) refuse(e.message)
    throw e
  }
}

/** The JSON body as an object ({} if it is none). */
export async function readObject(event: H3Event): Promise<Record<string, unknown>> {
  const body: unknown = await readBody(event).catch(() => null)
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

/** Sends a stored file as a download (or inline, e.g. a PDF shown in the browser). */
export function sendFile(event: H3Event, content: Buffer, filename: string, type: string, inline = false) {
  // Received files come from strangers (e-mail, uploads). Shown in the browser, an XML file
  // could carry XHTML with scripts on the cockpit's origin, so it is shown as plain text.
  setResponseHeader(event, 'Content-Type', inline && type === 'application/xml' ? 'text/plain; charset=utf-8' : type)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Length', content.length)
  const safe = filename.replace(/[^\w.-]+/g, '_')
  setResponseHeader(event, 'Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safe}"`)
  return content
}

/** The fields of an invoice draft from the request body; 422 with the German message otherwise. */
export async function readDraft(event: H3Event): Promise<DraftInput> {
  const { master } = useErp(event)
  const body = await readObject(event)
  const [settings, customers, projects] = await Promise.all([master.settings(), master.customerIds(), master.projects()])
  const head = headFromBody(body, { customers, projects: projects.map(p => p.id) })
  if (typeof head === 'string') refuse(head)
  const deliveryDate = isoDate(body.deliveryDate)
  if (deliveryDate === null) refuse('Bitte das Leistungsdatum angeben (§ 14 Abs. 4 Nr. 6 UStG).')
  const paymentDays = Number(body.paymentDays ?? settings?.paymentDays ?? 14)
  if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 120) refuse('Das Zahlungsziel muss zwischen 0 und 120 Tagen liegen.')
  const lines = linesFromForm(body.lines, settings?.smallBusiness ?? true)
  if (typeof lines === 'string') refuse(lines)
  return { ...head, deliveryDate, paymentDays, lines }
}

/** Choices for the document editors: active customers, projects, the catalog, the tax rules. */
export async function editorData(event: H3Event) {
  const { master } = useErp(event)
  const [customers, projects, catalog, settings] = await Promise.all([master.customers(false), master.projects(), master.catalog(false), master.settings()])
  return {
    customers: customers.map(c => ({ id: c.id, name: c.name, email: c.email, projectId: c.projectId })),
    projects,
    catalog,
    smallBusiness: settings?.smallBusiness ?? true,
    paymentDays: settings?.paymentDays ?? 14,
    hasSettings: settings !== null,
  }
}

/** A recurring invoice from the request body; 422 with the German message otherwise. */
export async function readSubscription(event: H3Event) {
  const { master } = useErp(event)
  const body = await readObject(event)
  const [settings, customers, projects] = await Promise.all([master.settings(), master.customerIds(), master.projects()])
  const subscription = subscriptionFromBody(body, { customers, projects: projects.map(p => p.id) })
  if (typeof subscription === 'string') refuse(subscription)
  const lines = linesFromForm(body.lines, settings?.smallBusiness ?? true)
  if (typeof lines === 'string') refuse(lines)
  return { subscription, lines }
}

/** A quote or order from the request body; 422 with the German message otherwise. */
export async function readSales(event: H3Event): Promise<SalesInput & { kind: SalesKind }> {
  const { master } = useErp(event)
  const body = await readObject(event)
  const [settings, customers, projects] = await Promise.all([master.settings(), master.customerIds(), master.projects()])
  const kind = body.kind === 'order' ? 'order' : 'quote'
  const head = headFromBody(body, { customers, projects: projects.map(p => p.id) })
  if (typeof head === 'string') refuse(head)
  const dateOrNull = (value: unknown, message: string) => {
    if (value === '' || value === null || value === undefined) return null
    return isoDate(value) ?? refuse(message)
  }
  const validUntil = dateOrNull(body.validUntil, 'Das Datum „gültig bis“ ist ungültig.')
  const deliveryDate = dateOrNull(body.deliveryDate, 'Das Leistungsdatum ist ungültig.')
  const lines = linesFromForm(body.lines, settings?.smallBusiness ?? true)
  if (typeof lines === 'string') refuse(lines)
  return { kind, ...head, validUntil, deliveryDate, lines }
}

/** A time entry from the request body; 422 with the German message otherwise. */
export async function readTimeEntry(event: H3Event): Promise<TimeInput> {
  const { master, pool } = useErp(event)
  const body = await readObject(event)
  const [settings, customers, projects, orders] = await Promise.all([master.settings(), master.customerIds(), master.projects(), new TimeRepository(pool).orders()])
  const entry = timeFromBody(body, { customers, projects: projects.map(p => p.id), orders: orders.map(o => o.id) }, settings?.smallBusiness ?? true)
  if (typeof entry === 'string') refuse(entry)
  return entry
}
