/**
 * Identifies an image from its bytes (never from the client's declared mime type or file name) and reads its
 * pixel dimensions. Only formats every browser can display are accepted: JPEG, PNG, GIF and WebP.
 * SVG is deliberately NOT supported (it can carry script).
 */

const TYPES = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

export const SUPPORTED_IMAGE_LABEL = 'JPG, PNG, WebP or GIF';

function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** EXIF orientation (1-8) from a JPEG APP1 segment, or 1 when absent/unreadable. */
function exifOrientation(buf, start, length) {
  try {
    if (buf.subarray(start, start + 6).toString('latin1') !== 'Exif\0\0') return 1;
    const tiff = start + 6;
    const le = buf.subarray(tiff, tiff + 2).toString('latin1') === 'II';
    const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    const ifd = tiff + u32(tiff + 4);
    const end = start + length;
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) break;
      if (u16(entry) === 0x0112) {
        const v = u16(entry + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  } catch {
    /* malformed EXIF is not fatal — the image itself may still be fine */
  }
  return 1;
}

function jpegSize(buf) {
  let i = 2;
  let orientation = 1;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (buf[i] === 0xff && i < buf.length) i += 1; // fill bytes
    const marker = buf[i];
    i += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone markers
    if (marker === 0xd9 || marker === 0xda) return null; // reached image data without a frame header
    if (i + 2 > buf.length) return null;
    const len = buf.readUInt16BE(i);
    if (len < 2) return null;
    if (marker === 0xe1) orientation = exifOrientation(buf, i + 2, len - 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (i + 7 > buf.length) return null;
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      // orientations 5-8 are rotated 90°: what people see is height × width
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    i += len;
  }
  return null;
}

function webpSize(buf) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/** @returns {{ type: string, mime: string, ext: string, width: number, height: number } | null} */
export function imageInfo(buf) {
  const type = sniff(buf);
  if (!type) return null;
  let size = null;
  if (type === 'jpeg') size = jpegSize(buf);
  else if (type === 'png') size = buf.subarray(12, 16).toString('latin1') === 'IHDR' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
  else if (type === 'gif') size = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  else if (type === 'webp') size = webpSize(buf);
  if (!size || !size.width || !size.height || size.width > 100_000 || size.height > 100_000) return null;
  return { type, ...TYPES[type], ...size };
}
