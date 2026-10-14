import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Field-level encryption for sensitive profile values (bank account, Aadhaar, PAN, passport).
 * AES-256-GCM with a sub-key derived from the existing data key, so salary-slip keys and profile keys never
 * coincide. `aad` binds the ciphertext to one user + field: a value copied onto another record fails to decrypt.
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext)
 */
const key = Buffer.from(crypto.hkdfSync('sha256', env.salaryEncryptionKey, Buffer.from('hr-admin-panel'), Buffer.from('profile-fields:v1'), 32));

export function encryptField(plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
}

export function decryptField(stored, aad) {
  if (!stored) return '';
  if (!String(stored).startsWith('v1:')) throw new Error('Unknown field encryption format');
  const raw = Buffer.from(String(stored).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** "123456789012" -> "XXXX XXXX 9012" (keeps only the last `show` characters). */
export function mask(plain, show = 4) {
  const v = String(plain || '');
  if (!v) return '';
  const tail = v.slice(-show);
  const hidden = Math.max(v.length - show, 4);
  return `${'X'.repeat(hidden).replace(/(.{4})(?=.)/g, '$1 ')} ${tail}`.trim();
}

/** Associated data for a profile secret: binds the ciphertext to one employee + field. */
export const profileAad = (userId, field) => `profile:${userId}:${field}`;
