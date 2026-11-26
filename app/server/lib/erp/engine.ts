import { spawn } from 'node:child_process'
import { join } from 'node:path'

// The bridge to the PHP e-invoice code (bin/invoice.php). PHP keeps this job because
// horstoeko/zugferd is the mature library for ZUGFeRD/XRechnung and CI checks its
// output with the Mustang validator. Node starts `php bin/invoice.php render|read`,
// writes JSON (or the file) to its input and reads JSON from its output.

/** A party as printed on a document (seller or buyer), see src/Invoicing/JsonDocument.php. */
export interface PartyDocument {
  name: string
  street: string
  postcode: string
  city: string
  country: string
  taxNumber?: string | null
  vatId?: string | null
  email?: string | null
  phone?: string | null
  contactName?: string | null
}

export interface RenderDocument {
  mode: 'invoice' | 'draft' | 'quote' | 'order'
  number: string
  type?: '380' | '381'
  issueDate: string
  deliveryDate: string
  dueDate: string
  seller: PartyDocument
  buyer: PartyDocument
  lines: { name: string, description: string | null, quantityMilli: number, unit: string, unitPriceCents: number, vatRate: number }[]
  smallBusiness: boolean
  iban: string
  bic?: string | null
  exemptionReason?: string | null
  note?: string | null
  precedingNumber?: string | null
  logo?: { data: string, type: string } | null
}

/** The fields of an incoming e-invoice, see src/Invoicing/IncomingReader.php. */
export interface IncomingFields {
  format: 'zugferd-pdf' | 'cii-xml'
  number: string
  typeCode: string
  issueDate: string | null
  dueDate: string | null
  deliveryDate: string | null
  currency: string
  supplier: { name: string, vatId: string | null, taxNumber: string | null, street: string | null, postcode: string | null, city: string | null, country: string | null, email: string | null }
  iban: string | null
  netCents: number
  taxCents: number
  grossCents: number
  dueCents: number
  lines: { name: string, quantity: number, unit: string, netCents: number, vatRate: number }[]
  taxes: { category: string, rate: number, basisCents: number, taxCents: number }[]
}

/** The input was refused by the PHP side (exit code 2): a message for the user, not a crash. */
export class EngineInputError extends Error {}

export class InvoiceEngine {
  /**
   * @param phpDir folder with bin/invoice.php and vendor/ (the repository root, on the server the app folder)
   * @param timeoutMs a render takes well under a second; a hanging process is killed
   */
  constructor(private readonly phpBinary: string, private readonly phpDir: string, private readonly timeoutMs = 30_000) {}

  /** PDF (and for mode invoice the XML embedded in it) of a document. */
  async render(document: RenderDocument): Promise<{ pdf: Buffer, xml: string | null }> {
    const out = await this.run('render', Buffer.from(JSON.stringify(document), 'utf8')) as { pdf: string, xml: string | null }
    return { pdf: Buffer.from(out.pdf, 'base64'), xml: out.xml }
  }

  /** The structured data of an incoming ZUGFeRD PDF or CII XML; EngineInputError if there is none. */
  async read(bytes: Buffer): Promise<IncomingFields> {
    return await this.run('read', bytes) as IncomingFields
  }

  private run(command: 'render' | 'read', input: Buffer): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.phpBinary, [join(this.phpDir, 'bin/invoice.php'), command], { stdio: ['pipe', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => child.kill('SIGKILL'), this.timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`PHP could not be started (${this.phpBinary}): ${e.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const text = Buffer.concat(out).toString('utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        }
        catch {
          parsed = null
        }
        if (code === 0 && parsed !== null) {
          resolve(parsed)
          return
        }
        const message = (parsed as { error?: unknown } | null)?.error
        if (code === 2 && typeof message === 'string') {
          reject(new EngineInputError(message))
          return
        }
        const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 2000) || text.slice(0, 2000)
        reject(new Error(`bin/invoice.php ${command} failed (exit ${code ?? 'killed'}): ${detail}`))
      })
      // A process that dies early closes its input; that error is reported by 'close'.
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    })
  }
}
