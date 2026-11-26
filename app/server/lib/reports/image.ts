// Reads type and size of a PNG, JPEG or WebP image from its first bytes, like PHP's
// getimagesizefromstring() for these three types. Used to check that a screenshot in a bug
// report really is the image it claims to be; the image itself is never decoded.

export interface ImageInfo { mime: 'image/png' | 'image/jpeg' | 'image/webp', width: number, height: number }

export function imageSize(bytes: Buffer): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes)
}

function png(b: Buffer): ImageInfo | null {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  // Signature, then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4).
  if (b.length < 24 || !b.subarray(0, 8).equals(signature) || b.toString('latin1', 12, 16) !== 'IHDR') return null
  return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return null
    const marker = b[i + 1]!
    if (marker === 0xFF) { // fill byte
      i++
      continue
    }
    if (marker === 0xD9 || marker === 0xDA) return null // end of image / start of scan before any frame header
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { // markers without a length
      i += 2
      continue
    }
    const length = b.readUInt16BE(i + 2)
    // Start of frame (SOF0–SOF15 except DHT C4, JPG C8 and DAC CC): precision (1), height (2), width (2).
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (i + 9 > b.length) return null
      return { mime: 'image/jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
    }
    if (length < 2) return null
    i += 2 + length
  }
  return null
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') {
    // Lossy: frame tag (3), start code 9D 01 2A, then 14-bit width and height.
    if (b[23] !== 0x9D || b[24] !== 0x01 || b[25] !== 0x2A) return null
    return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3FFF, height: b.readUInt16LE(28) & 0x3FFF }
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 2F, then width-1 and height-1 in 14 bits each.
    if (b[20] !== 0x2F) return null
    const bits = b.readUInt32LE(21)
    return { mime: 'image/webp', width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
  }
  if (chunk === 'VP8X') {
    // Extended: flags (4), then canvas width-1 and height-1 in 24 bits each.
    return { mime: 'image/webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
  }
  return null
}
