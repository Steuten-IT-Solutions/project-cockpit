import { Resvg } from '@resvg/resvg-js'

// An SVG logo is turned into a PNG once, at upload. The PDF engine (FPDF) prints only
// PNG and JPEG, and the browser preview then also shows only that PNG: the SVG itself
// is never served, so a hostile SVG cannot run anything in the cockpit. Before
// rendering, the SVG is checked strictly and refused if it contains anything that is
// not a plain drawing (scripts, embedded HTML, links to files or the web).

/** The printed logo is at most 70 x 25 mm (InvoicePdf::logo); 600 dpi keeps it sharp in print. */
const MAX_WIDTH_PX = Math.round(70 / 25.4 * 600)
const MAX_HEIGHT_PX = Math.round(25 / 25.4 * 600)

/** True if the bytes look like an SVG document (after an optional XML declaration or comments). */
export function isSvg(data: Buffer): boolean {
  const head = data.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '')
  return /<svg[\s>]/i.test(head) && /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)
}

/** Character references decoded, so that "&#104;ttp" is checked as "http". */
function decodeReferences(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec) % 0x110000))
    .replace(/&(quot|apos|lt|gt|amp);/g, (_, name: string) => ({ quot: '"', apos: '\'', lt: '<', gt: '>', amp: '&' })[name]!)
}

/** Only links inside the file (#id) and embedded PNG/JPEG images are allowed. */
const ALLOWED_LINK = /^\s*(#|data:image\/(png|jpeg);base64,)/i

/** Why the SVG is refused, or null if it is a plain drawing. */
export function svgProblem(svg: string): string | null {
  for (const text of [svg, decodeReferences(svg)]) {
    if (/<!(DOCTYPE|ENTITY)/i.test(text)) return 'Das SVG enthält eine DOCTYPE- oder ENTITY-Angabe. Bitte exportiere es als einfaches SVG.'
    if (/<(script|foreignObject|iframe|embed|object|audio|video|canvas|handler|listener)[\s>/]/i.test(text)) return 'Das SVG enthält Skripte oder eingebettete Inhalte. Bitte exportiere es als einfaches SVG.'
    if (/\son[a-z]+\s*=/i.test(text)) return 'Das SVG enthält Skripte (on…-Attribute). Bitte exportiere es als einfaches SVG.'
    if (/@import/i.test(text)) return 'Das SVG lädt Stylesheets nach. Bitte exportiere es als einfaches SVG.'
    for (const match of text.matchAll(/\b(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi)) {
      if (!ALLOWED_LINK.test(match[2]!)) return 'Das SVG verweist auf andere Dateien oder Webseiten. Bitte bette Bilder ein oder wandle sie in Pfade um.'
    }
    for (const match of text.matchAll(/url\(\s*(["']?)([^)]*)/gi)) {
      if (!match[2]!.trimStart().startsWith('#')) return 'Das SVG verweist auf andere Dateien oder Webseiten. Bitte bette Bilder ein oder wandle sie in Pfade um.'
    }
  }
  return null
}

/**
 * The SVG as PNG, fitted into the printed size at 600 dpi with a transparent
 * background. `hasText` is true if the logo uses fonts: those are drawn with the
 * fonts installed on the server, which may differ from the designer's.
 */
export function svgToPng(svg: string): { png: Buffer, hasText: boolean } | string {
  const problem = svgProblem(svg)
  if (problem !== null) return problem
  let png: Buffer
  try {
    // No resourcesDir: relative paths are not resolved, and svgProblem() already allows no outside links.
    const probe = new Resvg(svg, { font: { loadSystemFonts: false } })
    if (!(probe.width > 0 && probe.height > 0)) return 'Das SVG hat keine Größe (width/height oder viewBox fehlen).'
    const zoom = Math.min(MAX_WIDTH_PX / probe.width, MAX_HEIGHT_PX / probe.height)
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoom }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } })
    png = resvg.render().asPng()
  }
  catch {
    return 'Das SVG kann nicht gelesen werden.'
  }
  return { png, hasText: /<text[\s>]/i.test(svg) }
}
