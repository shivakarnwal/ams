import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Short-lived, signed URLs for gallery images.
 *
 * <img src> and plain download links cannot send the Authorization header, and the JWT must never be put in a URL.
 * Instead, an authenticated API response hands out URLs signed with a server-side key that grant access to ONE
 * variant of ONE photo until `exp`. Expiry is rounded up to a time bucket, so the same URL is returned for a
 * while and browsers can cache the image.
 */

const key = crypto.createHmac('sha256', env.jwtSecret).update('gallery:signed-file-urls:v1').digest();

export const VARIANTS = ['thumb', 'preview', 'original'];

const mac = (id, variant, exp) => crypto.createHmac('sha256', key).update(`${id}.${variant}.${exp}`).digest('base64url').slice(0, 32);

/** Expiry (unix seconds) valid for at least one TTL and at most two. */
export function bucketExpiry(now = Date.now()) {
  const ttl = env.galleryUrlTtlHours * 3600;
  const sec = Math.floor(now / 1000);
  return (Math.floor(sec / ttl) + 2) * ttl;
}

/** Path relative to the API root (`/api/v1`). */
export function signedFilePath(id, variant, exp = bucketExpiry()) {
  return `/gallery/photos/${id}/file?v=${variant}&exp=${exp}&sig=${mac(String(id), variant, exp)}`;
}

export function verifySignature(id, variant, exp, sig, now = Date.now()) {
  const expNum = Number(exp);
  if (!VARIANTS.includes(variant) || !Number.isInteger(expNum) || typeof sig !== 'string') return false;
  if (expNum * 1000 <= now) return false;
  const expected = Buffer.from(mac(String(id), variant, expNum));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
