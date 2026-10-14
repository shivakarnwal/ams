import mongoose from 'mongoose';

/**
 * Binary files live in MongoDB GridFS, so they are backed up and replicated with the rest of the data and no
 * shared disk/volume is needed when the API runs on several instances. Each feature uses its own bucket.
 */
export function createFileStore(bucketName) {
  const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
  return {
    put(buffer, { filename, contentType, metadata = {} }) {
      return new Promise((resolve, reject) => {
        const up = bucket().openUploadStream(filename, { metadata: { ...metadata, contentType } });
        up.once('finish', () => resolve(up.id));
        up.once('error', reject);
        up.end(buffer);
      });
    },
    open: (id) => bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id))),
    /** Best-effort delete; already-missing files are ignored. */
    async remove(ids) {
      const b = bucket();
      await Promise.all(ids.filter(Boolean).map((id) => b.delete(new mongoose.Types.ObjectId(String(id))).catch(() => {})));
    },
    /** Drops every file in the bucket (used by the seed script's reset). */
    async drop() {
      const db = mongoose.connection.db;
      await Promise.all([`${bucketName}.files`, `${bucketName}.chunks`].map((c) => db.collection(c).deleteMany({})));
    },
  };
}

/** Streams a stored file to the response; a missing GridFS file becomes a 404 instead of a broken response. */
export function streamFile(store, fileId, res, next, notFoundError) {
  const stream = store.open(fileId);
  stream.once('error', (err) => {
    if (!res.headersSent) {
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
      return next(notFoundError);
    }
    res.destroy(err);
  });
  stream.pipe(res);
}

/** RFC 6266 attachment/inline header that survives non-ASCII names. */
export function contentDisposition(name, type = 'attachment') {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/* ---- gallery (kept as named exports for the existing gallery code) ---- */
const gallery = createFileStore('galleryFiles');
export const putFile = (buffer, opts) => gallery.put(buffer, opts);
export const openFile = (id) => gallery.open(id);
export const deleteFiles = (ids) => gallery.remove(ids);
export const dropAllFiles = () => gallery.drop();

export const policyFiles = createFileStore('policyFiles');
export const ticketFiles = createFileStore('ticketFiles');
