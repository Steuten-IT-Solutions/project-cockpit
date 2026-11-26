import { InvoiceRepository } from '../../lib/erp/invoices'
import { IncomingRepository } from '../../lib/erp/incoming'
import { SubscriptionRepository } from '../../lib/erp/subscriptions'
import { TimeRepository } from '../../lib/erp/timeEntries'
import { addDays } from '#shared/lib/erp'

// The ERP's start page: what needs attention.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const erp = useErp(event)
  const today = erp.today()
  const [invoices, incoming, subscriptions, time, settings] = await Promise.all([
    new InvoiceRepository(erp.pool).list(today), new IncomingRepository(erp.pool).list(), new SubscriptionRepository(erp.pool).list(),
    new TimeRepository(erp.pool).list(addDays(today, -1)), erp.master.settings(),
  ])
  const unpaid = invoices.filter(i => i.state === 'open' || i.state === 'overdue')
  const overdue = unpaid.filter(i => i.state === 'overdue')
  const openIncoming = incoming.filter(i => i.status === 'open')
  const openTime = time.filter(t => t.invoiceId === null)
  return {
    hasSettings: settings !== null,
    drafts: invoices.filter(i => i.state === 'draft').length,
    unpaid: { count: unpaid.length, cents: unpaid.reduce((s, i) => s + i.grossCents - i.paidCents, 0) },
    overdue: { count: overdue.length, cents: overdue.reduce((s, i) => s + i.grossCents - i.paidCents, 0) },
    incoming: { count: openIncoming.length, cents: openIncoming.reduce((s, i) => s + i.grossCents, 0), dueSoon: openIncoming.filter(i => i.dueDate !== null && i.dueDate <= addDays(today, 7)).length },
    subscriptions: subscriptions.filter(s => s.active).map(s => ({ id: s.id, name: s.name, customerName: s.customerName, nextDate: s.nextDate })).slice(0, 5),
    time: { count: openTime.length, hoursMilli: openTime.filter(t => t.unit === 'HUR').reduce((s, t) => s + t.quantityMilli, 0) },
    overdueList: overdue.slice(0, 10).map(i => ({ id: i.id, number: i.number, customerName: i.customerName, dueDate: i.dueDate, openCents: i.grossCents - i.paidCents, reminderLevel: i.reminderLevel })),
    today,
  }
})
