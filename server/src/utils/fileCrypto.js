import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** AES-256-GCM. `aad` binds the ciphertext to its record, so a blob copied onto another record fails to decrypt. */
export function encryptBuffer(plain, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', env.salaryEncryptionKey, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data, iv, authTag: cipher.getAuthTag() };
}

export function decryptBuffer({ data, iv, authTag }, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', env.salaryEncryptionKey, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
