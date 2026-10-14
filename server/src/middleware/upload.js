import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.salarySlipMaxMb * 1024 * 1024, files: 1, fields: 10, fieldSize: 2048 },
}).single('file');

/** Parses a single multipart `file` field into req.file (memory) and maps multer errors to API errors. */
export function uploadPdf(req, res, next) {
  parser(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `File is too large (max ${env.salarySlipMaxMb} MB)`, { file: `Max size is ${env.salarySlipMaxMb} MB` }));
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(ApiError.badRequest('Unexpected file field — upload the PDF in a field named "file"'));
      return next(ApiError.badRequest(`Upload failed: ${err.message}`));
    }
    next(err);
  });
}

const imageParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.galleryMaxMb * 1024 * 1024, files: 3, fields: 10, fieldSize: 2048 },
}).fields([
  { name: 'file', maxCount: 1 }, // the photo as taken — required
  { name: 'preview', maxCount: 1 }, // optional screen-sized rendition made by the browser
  { name: 'thumb', maxCount: 1 }, // optional grid-sized rendition made by the browser
]);

/** One photo per request: `file` (+ optional `preview`, `thumb`). Files end up in req.files[field][0]. */
export function uploadImage(req, res, next) {
  imageParser(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `Image is too large (max ${env.galleryMaxMb} MB)`, { file: `Max size is ${env.galleryMaxMb} MB` }));
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(ApiError.badRequest('Unexpected file field — send the photo as "file" (optional "preview" and "thumb")'));
      return next(ApiError.badRequest(`Upload failed: ${err.message}`));
    }
    next(err);
  });
}

/**
 * Generic document upload: up to `maxCount` files in field `field` (req.files), plus normal text fields.
 * Use AFTER authorisation so unauthorised callers can never push bytes into memory.
 */
export function uploadDocs({ field = 'file', maxCount = 1, maxMb }) {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: maxCount, fields: 20, fieldSize: 64 * 1024 },
  }).array(field, maxCount);
  return (req, res, next) =>
    parser(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `File is too large (max ${maxMb} MB)`, { [field]: `Max size is ${maxMb} MB per file` }));
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new ApiError(422, 'Validation failed', { [field]: maxCount > 1 ? `Attach at most ${maxCount} files, in the "${field}" field` : `Send the document in a field named "${field}"` }));
        }
        return next(ApiError.badRequest(`Upload failed: ${err.message}`));
      }
      next(err);
    });
}
