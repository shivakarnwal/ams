import { imageInfo } from './imageInfo.js';

/**
 * Identifies an uploaded document from its bytes AND its extension (both must agree), so a renamed
 * executable or script can never be stored as a "policy.pdf" or a ticket attachment.
 *
 * kinds: pdf | word | excel | powerpoint | image | text
 */

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const OOXML = {
  docx: { kind: 'word', marker: 'word/', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'excel', marker: 'xl/', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'powerpoint', marker: 'ppt/', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};
const LEGACY = {
  doc: { kind: 'word', mime: 'application/msword' },
  xls: { kind: 'excel', mime: 'application/vnd.ms-excel' },
  ppt: { kind: 'powerpoint', mime: 'application/vnd.ms-powerpoint' },
};
const TEXT = { txt: 'text/plain', csv: 'text/csv', log: 'text/plain' };

export const extOf = (name = '') => (String(name).match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase();

function looksLikeText(buf) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ kind: string, mime: string, ext: string } | null} */
export function docInfo(buf, originalName) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  const ext = extOf(originalName);

  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return ext === 'pdf' ? { kind: 'pdf', mime: 'application/pdf', ext } : null;

  const img = imageInfo(buf);
  if (img) return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? { kind: 'image', mime: img.mime, ext: img.ext } : null;

  if (buf.subarray(0, 4).equals(ZIP)) {
    const spec = OOXML[ext];
    if (!spec) return null;
    const text = buf.toString('latin1');
    return text.includes('[Content_Types].xml') && text.includes(spec.marker) ? { kind: spec.kind, mime: spec.mime, ext } : null;
  }

  if (buf.subarray(0, 8).equals(OLE)) return LEGACY[ext] ? { ...LEGACY[ext], ext } : null;

  if (TEXT[ext] && looksLikeText(buf)) return { kind: 'text', mime: TEXT[ext], ext };
  return null;
}

export const POLICY_KINDS = ['pdf', 'word', 'excel', 'powerpoint', 'image'];
export const POLICY_TYPES_LABEL = 'PDF, Word, Excel, PowerPoint, JPG or PNG';
export const TICKET_KINDS = ['pdf', 'word', 'excel', 'image', 'text'];
export const TICKET_TYPES_LABEL = 'images, PDF, Word, Excel or text/log files';

/** Multipart file names arrive latin1-decoded; recover UTF-8 names (e.g. Hindi) when that is what was sent. */
const decodeName = (n) => {
  if (!/[\x80-\xff]/.test(n) || /[^\x00-\xff]/.test(n)) return n;
  const u = Buffer.from(n, 'latin1').toString('utf8');
  return u.includes('\uFFFD') ? n : u;
};

/** Strips any path and control characters from a client-supplied file name. */
export const cleanFileName = (name = '') =>
  decodeName(String(name)).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200) || 'file'; // eslint-disable-line no-control-regex
