import type { Line } from '../lib/erp'

// What the ERP's API answers (server/api/erp) and the pages show. Amounts in cents,
// quantities in thousandths, dates 'YYYY-MM-DD', timestamps UTC 'YYYY-MM-DD HH:MM:SS'.

export interface CompanySettings {
  name: string
  contactName: string | null
  street: string
  postcode: string
  city: string
  country: string
  email: string | null
  phone: string | null
  website: string | null
  taxNumber: string | null
  vatId: string | null
  iban: string
  bic: string | null
  bankName: string | null
  smallBusiness: boolean
  paymentDays: number
  exemptionReason: string | null
  mailFrom: string | null
  mailFromInvoice: string | null
  mailFromCancellation: string | null
  mailFromReminder: string | null
  mailFromQuote: string | null
  mailFromOrder: string | null
  mailText: string | null
  hasLogo: boolean
}

export interface Customer {
  id: number
  kind: string
  name: string
  contactName: string | null
  street: string
  postcode: string
  city: string
  country: string
  email: string | null
  vatId: string | null
  projectId: number | null
  note: string | null
  archived: boolean
}

export interface CatalogItem {
  id: number
  name: string
  description: string | null
  unit: string
  unitPriceCents: number
  vatRate: number
  archived: boolean
}

/** open: not yet due; overdue: due date passed; partial counts as open or overdue. */
export type InvoiceState = 'draft' | 'open' | 'overdue' | 'paid' | 'cancelled' | 'cancellation'

export interface InvoiceSummary {
  id: number
  type: '380' | '381'
  status: 'draft' | 'final'
  number: string | null
  customerId: number
  customerName: string
  projectId: number | null
  issueDate: string | null
  deliveryDate: string
  dueDate: string | null
  netCents: number
  taxCents: number
  grossCents: number
  paidCents: number
  state: InvoiceState
  reminderLevel: number
  sentAt: string | null
  precedingNumber: string | null
  cancelledBy: string | null
}

export interface InvoiceEvent { event: string, detail: string | null, createdAt: string }
export interface Payment { id: number, paidOn: string, amountCents: number, note: string | null }
export interface Reminder { id: number, level: number, sentOn: string, newDueDate: string, recipient: string }

export interface InvoiceDetail extends InvoiceSummary {
  paymentDays: number
  note: string | null
  lines: Line[]
  events: InvoiceEvent[]
  payments: Payment[]
  reminders: Reminder[]
  customerEmail: string | null
  hash: string | null
  /** The time entries this draft bills (module 6). */
  timeEntryIds: number[]
}

export interface Supplier {
  id: number
  name: string
  vatId: string | null
  taxNumber: string | null
  iban: string | null
  email: string | null
  street: string | null
  postcode: string | null
  city: string | null
  country: string | null
  note: string | null
}

/** An attachment from the mailbox for incoming invoices (server/lib/erp/mailbox.ts). */
export interface IncomingMailFile {
  id: number
  sender: string | null
  subject: string | null
  receivedAt: string | null
  fileName: string
  fileType: string
  status: 'new' | 'booked' | 'ignored'
  incomingInvoiceId: number | null
  problem: string | null
  createdAt: string
}

/** The mailbox settings as shown; the password is never sent back. */
export interface MailboxSettings {
  host: string | null
  user: string | null
  hasPassword: boolean
}

export interface IncomingInvoice {
  id: number
  supplierId: number
  supplierName: string
  status: 'open' | 'paid' | 'discarded'
  number: string
  issueDate: string
  dueDate: string | null
  netCents: number
  taxCents: number
  grossCents: number
  category: string
  projectId: number | null
  iban: string | null
  note: string | null
  format: string
  fileName: string
  fileType: string
  paidOn: string | null
  discardedReason: string | null
  createdAt: string
}

export interface Subscription {
  id: number
  customerId: number
  customerName: string
  projectId: number | null
  name: string
  intervalMonths: number
  nextDate: string
  endDate: string | null
  note: string | null
  active: boolean
  lines: Line[]
}

export interface SalesDocument {
  id: number
  kind: 'quote' | 'order'
  status: string
  number: string | null
  customerId: number
  customerName: string
  customerEmail: string | null
  projectId: number | null
  issueDate: string | null
  validUntil: string | null
  deliveryDate: string | null
  note: string | null
  quoteId: number | null
  quoteNumber: string | null
  invoiceId: number | null
  invoiceNumber: string | null
  orderId: number | null
  netCents: number
  taxCents: number
  grossCents: number
  lines: Line[]
}

export interface TimeEntry {
  id: number
  workDate: string
  customerId: number
  customerName: string
  projectId: number | null
  orderId: number | null
  orderNumber: string | null
  description: string
  quantityMilli: number
  unit: string
  unitPriceCents: number
  vatRate: number
  invoiceId: number | null
  invoiceNumber: string | null
  invoiceStatus: string | null
}

/** A short choice list for selects: customers, projects, orders. */
export interface Choice { id: number, name: string }
