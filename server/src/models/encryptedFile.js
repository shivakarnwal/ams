import mongoose from 'mongoose';

/**
 * Fields for a single PDF stored inline, encrypted with AES-256-GCM (see utils/fileCrypto.js).
 * The ciphertext, IV and tag are never selected by default and never serialised.
 */
export const encryptedFileFields = {
  fileName: { type: String, required: true },
  originalName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: 'application/pdf' },
  size: { type: Number, required: true, min: 1 },
  /** SHA-256 of the plaintext (integrity / duplicate detection) */
  checksum: { type: String, required: true },
  data: { type: Buffer, required: true, select: false },
  iv: { type: Buffer, required: true, select: false },
  authTag: { type: Buffer, required: true, select: false },
  fileReplacedAt: Date,
  downloadCount: { type: Number, default: 0 },
  lastDownloadedAt: Date,
};

export const auditFields = {
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
};

/** toJSON that exposes `id` and strips the encrypted payload. */
export function secureToJSON(schema, extra) {
  schema.set('toJSON', {
    versionKey: false,
    virtuals: true,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.data;
      delete ret.iv;
      delete ret.authTag;
      extra?.(ret);
      return ret;
    },
  });
}
