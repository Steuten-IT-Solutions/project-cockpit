// Recognizes uploaded files by their first bytes, not by the name or the browser's
// claim, which anyone can set.

export function logoType(data: Buffer): 'image/png' | 'image/jpeg' | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png'
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg'
  return null
}

/** Types accepted as incoming invoices: e-invoice XML, PDF and photos of paper invoices. */
export function incomingType(data: Buffer): 'application/pdf' | 'application/xml' | 'image/png' | 'image/jpeg' | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  const head = data.subarray(0, 200).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<')) return 'application/xml'
  return logoType(data)
}
