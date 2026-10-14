import { Album } from '../models/Album.js';
import { Photo } from '../models/Photo.js';
import { ApiError } from '../utils/ApiError.js';
import { isPrivileged } from '../utils/access.js';
import { deleteFiles, openFile, putFile } from '../utils/gridfs.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok } from '../utils/helpers.js';
import { SUPPORTED_IMAGE_LABEL, imageInfo } from '../utils/imageInfo.js';
import { bucketExpiry, signedFilePath, verifySignature } from '../utils/signedUrl.js';

const RECENT_DAYS = 7;
const USER_POP = { path: 'uploadedBy updatedBy', select: 'name' };
const ALBUM_POP = { path: 'album', select: 'name' };

const invalid = (errors) => new ApiError(422, 'Validation failed', errors);

/* ---------------- presentation ---------------- */

function urlsFor(id, exp = bucketExpiry()) {
  const original = signedFilePath(id, 'original', exp);
  return {
    thumb: signedFilePath(id, 'thumb', exp),
    preview: signedFilePath(id, 'preview', exp),
    original,
    download: `${original}&download=1`,
  };
}

const presentPhoto = (p, exp) => ({ ...p.toJSON(), urls: urlsFor(p._id, exp) });

/** Adds photoCount and a cover (explicit cover, else the newest photo) to each album. */
async function presentAlbums(albums) {
  if (!albums.length) return [];
  const stats = await Photo.aggregate([
    { $match: { album: { $in: albums.map((a) => a._id) } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$album', count: { $sum: 1 }, latest: { $first: '$_id' } } },
  ]);
  const byId = new Map(stats.map((s) => [String(s._id), s]));
  const exp = bucketExpiry();
  return albums.map((a) => {
    const s = byId.get(String(a._id));
    const coverId = a.coverPhoto || s?.latest;
    const { thumb, preview } = coverId ? urlsFor(coverId, exp) : {};
    return {
      ...a.toJSON(),
      coverPhoto: a.coverPhoto ? String(a.coverPhoto) : null,
      photoCount: s?.count ?? 0,
      cover: coverId ? { photoId: String(coverId), thumb, preview } : null,
    };
  });
}

/* ---------------- loaders ---------------- */

async function loadAlbum(id) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid album id');
  const album = await Album.findById(id);
  if (!album) throw ApiError.notFound('Album not found');
  return album;
}

async function loadPhoto(id) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid photo id');
  const photo = await Photo.findById(id);
  if (!photo) throw ApiError.notFound('Photo not found');
  return photo;
}

/** Bumps the album's updatedAt (used for "recently updated" sorting) without touching updatedBy. */
const touchAlbum = (id) => Album.updateOne({ _id: id }, { $set: { updatedAt: new Date() } }, { timestamps: false });

/** Strips any path and control characters from a client-supplied file name. */
const cleanName = (name = '') =>
  String(name).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255); // eslint-disable-line no-control-regex

/* ---------------- stats ---------------- */

export const stats = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const [albums, photos, recentUploads] = await Promise.all([
    Album.countDocuments(),
    Photo.countDocuments(),
    Photo.countDocuments({ createdAt: { $gte: since } }),
  ]);
  const data = { albums, photos, recentUploads, recentDays: RECENT_DAYS };
  if (isPrivileged(req.user)) {
    const [agg] = await Photo.aggregate([
      { $group: { _id: null, bytes: { $sum: { $add: [{ $ifNull: ['$original.size', 0] }, { $ifNull: ['$preview.size', 0] }, { $ifNull: ['$thumb.size', 0] }] } } } },
    ]);
    data.storageBytes = agg?.bytes ?? 0;
  }
  ok(res, data);
});

/* ---------------- albums ---------------- */

const ALBUM_SORT = {
  newest: { eventDate: -1, createdAt: -1 },
  oldest: { eventDate: 1, createdAt: 1 },
  name: { name: 1, createdAt: -1 },
  updated: { updatedAt: -1 },
};

export const listAlbums = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 12, maxLimit: 60 });
  const { q, year, sort } = req.query;
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { description: rx }];
  }
  if (year) filter.eventDate = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };

  const [items, total, years] = await Promise.all([
    Album.find(filter).sort(ALBUM_SORT[sort] || ALBUM_SORT.newest).skip(skip).limit(limit).populate('createdBy', 'name'),
    Album.countDocuments(filter),
    Album.aggregate([{ $group: { _id: { $year: '$eventDate' } } }, { $sort: { _id: -1 } }]),
  ]);
  ok(res, await presentAlbums(items), { meta: { ...buildMeta(page, limit, total), years: years.map((y) => y._id).filter(Boolean) } });
});

export const getAlbum = asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.id);
  await album.populate([{ path: 'createdBy', select: 'name' }, { path: 'updatedBy', select: 'name' }]);
  ok(res, (await presentAlbums([album]))[0]);
});

export const createAlbum = asyncHandler(async (req, res) => {
  const { eventDate, ...rest } = req.body;
  const album = await Album.create({ ...rest, ...(eventDate ? { eventDate } : {}), createdBy: req.user._id, updatedBy: req.user._id });
  ok(res, (await presentAlbums([album]))[0], { message: 'Album created' }, 201);
});

export const updateAlbum = asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.id);
  const { coverPhoto, ...rest } = req.body;
  if (coverPhoto) {
    const belongs = await Photo.exists({ _id: coverPhoto, album: album._id });
    if (!belongs) throw invalid({ coverPhoto: 'Cover must be a photo from this album' });
  }
  album.set({ ...rest, ...(coverPhoto !== undefined ? { coverPhoto } : {}), updatedBy: req.user._id });
  await album.save();
  ok(res, (await presentAlbums([album]))[0], { message: coverPhoto !== undefined && !Object.keys(rest).length ? 'Album cover updated' : 'Album updated' });
});

export const removeAlbum = asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.id);
  const photos = await Photo.find({ album: album._id }).select('original preview thumb');
  await Photo.deleteMany({ album: album._id });
  await album.deleteOne();
  await deleteFiles(photos.flatMap((p) => p.fileIds()));
  ok(res, { deletedPhotos: photos.length }, { message: photos.length ? `Album and ${photos.length} photo${photos.length > 1 ? 's' : ''} deleted` : 'Album deleted' });
});

/* ---------------- photos ---------------- */

export const listPhotos = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 24, maxLimit: 100 });
  const { album, q, sort } = req.query;
  const filter = {};
  if (album) filter.album = album;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ caption: rx }, { originalName: rx }];
  }
  const order = sort === 'oldest' ? 1 : -1;
  const [items, total] = await Promise.all([
    Photo.find(filter).sort({ createdAt: order, _id: order }).skip(skip).limit(limit).populate([ALBUM_POP, USER_POP]),
    Photo.countDocuments(filter),
  ]);
  const exp = bucketExpiry();
  ok(res, items.map((p) => presentPhoto(p, exp)), { meta: buildMeta(page, limit, total) });
});

export const getPhoto = asyncHandler(async (req, res) => {
  const photo = await loadPhoto(req.params.id);
  await photo.populate([ALBUM_POP, USER_POP]);
  ok(res, presentPhoto(photo));
});

/** Reads one optional browser-made rendition; it must be a real JPEG/PNG/WebP image. */
function rendition(req, field) {
  const f = req.files?.[field]?.[0];
  if (!f) return null;
  const info = imageInfo(f.buffer);
  if (!info || info.type === 'gif') throw invalid({ [field]: `The ${field} must be a JPG, PNG or WebP image` });
  return { buffer: f.buffer, info };
}

export const uploadPhoto = asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.id);
  const file = req.files?.file?.[0];
  if (!file) throw invalid({ file: 'Choose a photo to upload' });
  const info = imageInfo(file.buffer);
  if (!info) throw invalid({ file: `Only ${SUPPORTED_IMAGE_LABEL} images are allowed` });
  const preview = rendition(req, 'preview');
  const thumb = rendition(req, 'thumb');

  const stored = [];
  const put = async (buffer, meta, variant) => {
    const fileId = await putFile(buffer, { filename: `${variant}.${meta.ext}`, contentType: meta.mime, metadata: { album: album._id, variant } });
    stored.push(fileId);
    return { fileId, mimeType: meta.mime, size: buffer.length };
  };

  try {
    const photo = await Photo.create({
      album: album._id,
      caption: req.body.caption,
      originalName: cleanName(file.originalname),
      width: info.width,
      height: info.height,
      original: await put(file.buffer, info, 'original'),
      preview: preview ? await put(preview.buffer, preview.info, 'preview') : null,
      thumb: thumb ? await put(thumb.buffer, thumb.info, 'thumb') : null,
      uploadedBy: req.user._id,
    });
    await touchAlbum(album._id);
    await photo.populate([ALBUM_POP, USER_POP]);
    ok(res, presentPhoto(photo), { message: 'Photo uploaded' }, 201);
  } catch (err) {
    await deleteFiles(stored); // never leave orphaned bytes behind
    throw err;
  }
});

export const updatePhoto = asyncHandler(async (req, res) => {
  const photo = await loadPhoto(req.params.id);
  const { caption, album } = req.body;
  const from = photo.album;
  if (album && String(album) !== String(from)) {
    if (!(await Album.exists({ _id: album }))) throw invalid({ album: 'Album not found' });
    photo.album = album;
    await Album.updateOne({ _id: from, coverPhoto: photo._id }, { coverPhoto: null });
    await Promise.all([touchAlbum(from), touchAlbum(album)]);
  }
  if (caption !== undefined) photo.caption = caption;
  photo.updatedBy = req.user._id;
  await photo.save();
  await photo.populate([ALBUM_POP, USER_POP]);
  ok(res, presentPhoto(photo), { message: String(from) !== String(photo.album._id) ? `Photo moved to ${photo.album.name}` : 'Photo updated' });
});

async function deletePhotos(photos) {
  const ids = photos.map((p) => p._id);
  await Photo.deleteMany({ _id: { $in: ids } });
  await Album.updateMany({ coverPhoto: { $in: ids } }, { coverPhoto: null });
  await deleteFiles(photos.flatMap((p) => p.fileIds()));
}

export const removePhoto = asyncHandler(async (req, res) => {
  const photo = await loadPhoto(req.params.id);
  await deletePhotos([photo]);
  ok(res, null, { message: 'Photo deleted' });
});

export const bulkRemovePhotos = asyncHandler(async (req, res) => {
  const photos = await Photo.find({ _id: { $in: req.body.ids } }).select('original preview thumb');
  if (!photos.length) throw ApiError.notFound('No matching photos found');
  await deletePhotos(photos);
  ok(res, { deleted: photos.length }, { message: `${photos.length} photo${photos.length > 1 ? 's' : ''} deleted` });
});

/* ---------------- file streaming (signed URL, no bearer token) ---------------- */

const contentDisposition = (photo, mime) => {
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const base = (photo.originalName || '').replace(/\.[^.]+$/, '') || `photo-${photo._id}`;
  const name = `${base}.${ext}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export const file = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { v, exp, sig, download } = req.query;
  if (!isValidId(id) || !verifySignature(id, v, exp, sig)) {
    throw ApiError.forbidden('This image link is invalid or has expired. Reload the page to get a fresh link.');
  }
  const photo = await Photo.findById(id).select('original preview thumb originalName');
  if (!photo) throw ApiError.notFound('Photo not found');

  const ref = v === 'thumb' ? photo.thumb || photo.preview || photo.original : v === 'preview' ? photo.preview || photo.original : photo.original;
  const etag = `"${ref.fileId}"`;
  const maxAge = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000));
  const isDownload = download === '1';

  res.set({
    'Cache-Control': `private, max-age=${maxAge}`,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    // the SPA is served from another origin; helmet's default (same-origin) would block <img> loads
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  if (!isDownload && req.headers['if-none-match'] === etag) return res.status(304).end();

  res.set({
    'Content-Type': ref.mimeType,
    'Content-Length': String(ref.size),
    'Content-Disposition': isDownload ? contentDisposition(photo, ref.mimeType) : 'inline',
  });
  if (isDownload) Photo.updateOne({ _id: photo._id }, { $inc: { downloadCount: 1 } }).catch(() => {});

  const stream = openFile(ref.fileId);
  stream.once('error', (err) => {
    if (!res.headersSent) {
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
      return next(ApiError.notFound('Image file not found'));
    }
    res.destroy(err);
  });
  stream.pipe(res);
});
