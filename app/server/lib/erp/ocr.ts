import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The text of an incoming invoice without e-invoice data, for server/lib/erp/extract.ts.
// Most PDF invoices are written by a program and carry their text: pdftotext (poppler)
// reads it exactly. Scans and photos have no text; Tesseract recognizes it (OCR) with
// the German model. Both run as programs on the server, so the invoice never leaves it.
// They are installed by "cockpit-setup ocr" (bin/server-setup.sh); without them the
// form simply stays empty.

/** Where the text came from: the PDF's own text, OCR, or nothing (programs missing or no text). */
export type TextSource = 'pdf' | 'ocr' | null

export interface TextResult { text: string, source: TextSource, problem: string | null }

/** Below this many letters a PDF counts as a scan without text. */
const MIN_LETTERS = 40
/** Pages read by OCR: the totals of an invoice are on the first pages, and OCR takes a few seconds per page. */
const OCR_PAGES = 3
const TIMEOUT_MS = 60_000

type Run = (command: string, args: string[], input?: Buffer) => Promise<string>

/** Runs a program and returns its standard output; rejects with code ENOENT if it is not installed. */
export const runProgram: Run = (command, args, input) => new Promise((resolve, reject) => {
  const child = execFile(command, args, { timeout: TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    if (error) reject(error)
    else resolve(stdout)
  })
  if (input !== undefined) child.stdin?.end(input)
})

const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length
const missing = (e: unknown) => (e as { code?: unknown }).code === 'ENOENT'
const NOT_INSTALLED = 'Die Texterkennung ist auf dem Server nicht eingerichtet (cockpit-setup ocr).'

/** The text of a PDF, PNG or JPEG file. */
export async function invoiceText(data: Buffer, type: string, run: Run = runProgram): Promise<TextResult> {
  try {
    if (type === 'application/pdf') {
      const text = await run('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], data)
      if (letters(text) >= MIN_LETTERS) return { text, source: 'pdf', problem: null }
      return await ocrPdf(data, run)
    }
    if (type === 'image/png' || type === 'image/jpeg') {
      return { text: await run('tesseract', ['stdin', 'stdout', '-l', 'deu+eng'], data), source: 'ocr', problem: null }
    }
    return { text: '', source: null, problem: null }
  }
  catch (e) {
    if (missing(e)) return { text: '', source: null, problem: NOT_INSTALLED }
    console.error('[cockpit] reading the text of an invoice failed:', e)
    return { text: '', source: null, problem: 'Der Text der Datei konnte nicht gelesen werden.' }
  }
}

/**
 * A scanned PDF: its first pages as images (pdftoppm), each read by Tesseract. The long
 * side is scaled to 3500 pixels, about 300 dpi on A4, whatever page size the file claims.
 */
async function ocrPdf(data: Buffer, run: Run): Promise<TextResult> {
  const dir = await mkdtemp(join(tmpdir(), 'cockpit-ocr-'))
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, data)
    await run('pdftoppm', ['-scale-to', '3500', '-gray', '-png', '-f', '1', '-l', String(OCR_PAGES), pdf, join(dir, 'page')])
    const pages = (await readdir(dir)).filter(f => f.startsWith('page') && f.endsWith('.png')).sort()
    const texts: string[] = []
    for (const page of pages) texts.push(await run('tesseract', [join(dir, page), 'stdout', '-l', 'deu+eng']))
    return { text: texts.join('\n'), source: 'ocr', problem: null }
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}
