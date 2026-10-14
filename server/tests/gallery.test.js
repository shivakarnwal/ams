import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';

const G = '/api/v1/gallery';
const V1 = '/api/v1';
let t;

/* ---- tiny valid PNG generator (no image library needed) ---- */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, shade = 128) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const rows = Buffer.alloc((w * 3 + 1) * h, shade);
  for (let y = 0; y < h; y += 1) rows[y * (w * 3 + 1)] = 0; // filter byte
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const fetchFile = (path) => api.get(`${V1}${path}`).buffer(true).parse(binary);
const files = () => mongoose.connection.db.collection('galleryFiles.files');

const newAlbum = (token, body = { name: 'Diwali Pics 2025', description: 'Office celebration', eventDate: '2025-11-26' }) =>
  api.post(`${G}/albums`).set(auth(token)).send(body);
const upload = (token, albumId, { file = png(40, 30), filename = 'diwali.png', preview, thumb, caption } = {}) => {
  let r = api.post(`${G}/albums/${albumId}/photos`).set(auth(token));
  if (caption) r = r.field('caption', caption);
  if (file) r = r.attach('file', file, { filename, contentType: 'image/png' });
  if (preview) r = r.attach('preview', preview, { filename: 'preview.png', contentType: 'image/png' });
  if (thumb) r = r.attach('thumb', thumb, { filename: 'thumb.png', contentType: 'image/png' });
  return r;
};

let albumId;
let photo; // first uploaded photo (with renditions)

before(async () => {
  await start();
  t = {
    admin: await login('admin@example.com'),
    hr: await login('hr@example.com'),
    manager: await login('ashu.taneja@bharuwasolutions.com'),
    emp: await login('shiva.karnwal@bharuwasolutions.com'),
  };
});
after(stop);

describe('gallery: authentication & role-based access', () => {
  it('requires a token', async () => {
    assert.equal((await api.get(`${G}/albums`)).status, 401);
    assert.equal((await api.get(`${G}/photos`)).status, 401);
    assert.equal((await api.get(`${G}/stats`)).status, 401);
  });

  it('HR and Admin can create albums', async () => {
    const r = await newAlbum(t.hr.token);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.name, 'Diwali Pics 2025');
    assert.equal(r.body.data.photoCount, 0);
    assert.equal(r.body.data.cover, null);
    albumId = r.body.data.id;
    assert.equal((await newAlbum(t.admin.token, { name: 'Team Offsite' })).status, 201);
  });

  it('employees and managers are read-only', async () => {
    for (const who of [t.emp, t.manager]) {
      assert.equal((await api.get(`${G}/albums`).set(auth(who.token))).status, 200);
      assert.equal((await api.get(`${G}/photos`).set(auth(who.token))).status, 200);
      assert.equal((await api.get(`${G}/albums/${albumId}`).set(auth(who.token))).status, 200);
      assert.equal((await newAlbum(who.token)).status, 403);
      assert.equal((await upload(who.token, albumId)).status, 403);
      assert.equal((await api.put(`${G}/albums/${albumId}`).set(auth(who.token)).send({ name: 'Hacked' })).status, 403);
      assert.equal((await api.delete(`${G}/albums/${albumId}`).set(auth(who.token))).status, 403);
      assert.equal((await api.post(`${G}/photos/bulk-delete`).set(auth(who.token)).send({ ids: ['a'.repeat(24)] })).status, 403);
    }
    assert.equal(await files().countDocuments(), 0, 'rejected uploads must not store anything');
  });
});

describe('gallery: albums', () => {
  it('validates album input', async () => {
    const r = await newAlbum(t.hr.token, { name: '' });
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.name);
    assert.equal((await newAlbum(t.hr.token, { name: 'Ok name', eventDate: 'not-a-date' })).status, 422);
    assert.equal((await api.put(`${G}/albums/${albumId}`).set(auth(t.hr.token)).send({})).status, 422);
    assert.equal((await api.get(`${G}/albums/not-an-id`).set(auth(t.emp.token))).status, 400);
    assert.equal((await api.get(`${G}/albums/${'a'.repeat(24)}`).set(auth(t.emp.token))).status, 404);
  });

  it('lists, searches and filters by year', async () => {
    const all = await api.get(`${G}/albums`).set(auth(t.emp.token));
    assert.equal(all.body.meta.total, 2);
    assert.ok(all.body.meta.years.includes(2025));
    const found = await api.get(`${G}/albums?q=diwali`).set(auth(t.emp.token));
    assert.deepEqual(found.body.data.map((a) => a.name), ['Diwali Pics 2025']);
    const y = await api.get(`${G}/albums?year=2025`).set(auth(t.emp.token));
    assert.equal(y.body.meta.total, 1);
    assert.equal((await api.get(`${G}/albums?sort=bogus`).set(auth(t.emp.token))).status, 422);
  });

  it('updates an album', async () => {
    const r = await api.patch(`${G}/albums/${albumId}`).set(auth(t.admin.token)).send({ description: 'Lights and rangoli' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.description, 'Lights and rangoli');
    assert.equal(r.body.data.name, 'Diwali Pics 2025');
  });
});

describe('gallery: uploads', () => {
  it('rejects missing, fake and unsupported files', async () => {
    assert.equal((await upload(t.hr.token, albumId, { file: null })).status, 422);
    const fake = await upload(t.hr.token, albumId, { file: Buffer.from('MZ this is an exe, not an image'), filename: 'photo.png' });
    assert.equal(fake.status, 422);
    assert.ok(fake.body.errors.file);
    const svg = await upload(t.hr.token, albumId, { file: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), filename: 'x.svg' });
    assert.equal(svg.status, 422);
    const badThumb = await upload(t.hr.token, albumId, { thumb: Buffer.from('not an image at all, honestly') });
    assert.equal(badThumb.status, 422);
    assert.ok(badThumb.body.errors.thumb);
    assert.equal((await upload(t.hr.token, 'a'.repeat(24))).status, 404);
    assert.equal(await files().countDocuments(), 0);
  });

  it('stores the original plus browser-made renditions', async () => {
    const r = await upload(t.hr.token, albumId, { file: png(64, 48, 10), preview: png(32, 24, 20), thumb: png(16, 12, 30), caption: 'Rangoli at reception' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    photo = r.body.data;
    assert.equal(photo.width, 64);
    assert.equal(photo.height, 48);
    assert.equal(photo.mimeType, 'image/png');
    assert.equal(photo.caption, 'Rangoli at reception');
    assert.equal(photo.originalName, 'diwali.png');
    assert.equal(photo.album.name, 'Diwali Pics 2025');
    assert.equal(photo.uploadedBy.name, 'HR Manager');
    for (const k of ['thumb', 'preview', 'original', 'download']) assert.match(photo.urls[k], /^\/gallery\/photos\/[a-f0-9]{24}\/file\?v=\w+&exp=\d+&sig=/);
    for (const k of ['original', 'preview', 'thumb']) assert.equal(photo[k], undefined, `${k} storage details must not leak`);
    assert.equal(await files().countDocuments(), 3);
  });

  it('accepts GIF originals and works without renditions', async () => {
    const r = await upload(t.admin.token, albumId, { file: GIF, filename: 'tiny.gif' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.mimeType, 'image/gif');
    assert.equal(r.body.data.width, 1);
  });
});

describe('gallery: signed image URLs', () => {
  it('serves each variant to anyone holding the signed URL (employees included)', async () => {
    const list = await api.get(`${G}/photos?album=${albumId}`).set(auth(t.emp.token));
    const p = list.body.data.find((x) => x.id === photo.id);
    const thumb = await fetchFile(p.urls.thumb);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers['content-type'], 'image/png');
    assert.equal(thumb.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.match(thumb.headers['cache-control'], /^private, max-age=\d+$/);
    assert.ok(thumb.body.equals(png(16, 12, 30)));
    assert.ok((await fetchFile(p.urls.preview)).body.equals(png(32, 24, 20)));
    assert.ok((await fetchFile(p.urls.original)).body.equals(png(64, 48, 10)));
  });

  it('sends downloads as attachments and counts them', async () => {
    const dl = await fetchFile(photo.urls.download);
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="diwali\.png"/);
    let count = 0;
    for (let i = 0; i < 20 && count === 0; i += 1) { // the counter is updated without delaying the stream
      count = (await api.get(`${G}/photos/${photo.id}`).set(auth(t.hr.token))).body.data.downloadCount;
      if (!count) await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(count, 1);
  });

  it('supports conditional requests', async () => {
    const first = await fetchFile(photo.urls.thumb);
    const again = await api.get(`${V1}${photo.urls.thumb}`).set('If-None-Match', first.headers.etag);
    assert.equal(again.status, 304);
  });

  it('falls back to the original when a rendition was not uploaded', async () => {
    const list = await api.get(`${G}/photos?album=${albumId}`).set(auth(t.emp.token));
    const gif = list.body.data.find((x) => x.mimeType === 'image/gif');
    const r = await fetchFile(gif.urls.thumb);
    assert.equal(r.status, 200);
    assert.ok(r.body.equals(GIF));
  });

  it('rejects missing, tampered, swapped and expired signatures', async () => {
    assert.equal((await api.get(`${G}/photos/${photo.id}/file?v=thumb`)).status, 422);
    const tampered = photo.urls.thumb.replace(/sig=(.)/, (_m, c) => `sig=${c === 'A' ? 'B' : 'A'}`);
    assert.equal((await api.get(`${V1}${tampered}`)).status, 403);
    // a thumb signature must not unlock the original
    assert.equal((await api.get(`${V1}${photo.urls.thumb.replace('v=thumb', 'v=original')}`)).status, 403);
    // signature for one photo must not unlock another
    const other = photo.urls.thumb.replace(photo.id, 'b'.repeat(24));
    assert.equal((await api.get(`${V1}${other}`)).status, 403);
    const { signedFilePath } = await import('../src/utils/signedUrl.js');
    const expired = signedFilePath(photo.id, 'thumb', Math.floor(Date.now() / 1000) - 60);
    assert.equal((await api.get(`${V1}${expired}`)).status, 403);
  });
});

describe('gallery: photos, covers, stats and deletion', () => {
  let otherAlbumId;

  it('reports counts and the cover on albums', async () => {
    const r = await api.get(`${G}/albums/${albumId}`).set(auth(t.emp.token));
    assert.equal(r.body.data.photoCount, 2);
    assert.ok(r.body.data.cover.thumb.startsWith(`/gallery/photos/${r.body.data.cover.photoId}/file`));
  });

  it('sets an explicit cover only from the same album', async () => {
    const other = await newAlbum(t.hr.token, { name: 'Annual Day' });
    otherAlbumId = other.body.data.id;
    const wrong = await api.patch(`${G}/albums/${otherAlbumId}`).set(auth(t.hr.token)).send({ coverPhoto: photo.id });
    assert.equal(wrong.status, 422);
    const r = await api.patch(`${G}/albums/${albumId}`).set(auth(t.hr.token)).send({ coverPhoto: photo.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.cover.photoId, photo.id);
  });

  it('edits captions and moves photos (clearing a stale cover)', async () => {
    const r = await api.patch(`${G}/photos/${photo.id}`).set(auth(t.hr.token)).send({ caption: 'Front desk rangoli', album: otherAlbumId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.caption, 'Front desk rangoli');
    assert.equal(r.body.data.album.id, otherAlbumId);
    const old = await api.get(`${G}/albums/${albumId}`).set(auth(t.hr.token));
    assert.equal(old.body.data.coverPhoto, null);
    assert.equal(old.body.data.photoCount, 1);
    assert.equal((await api.patch(`${G}/photos/${photo.id}`).set(auth(t.hr.token)).send({ album: 'c'.repeat(24) })).status, 422);
  });

  it('lists photos newest first and searches captions', async () => {
    const all = await api.get(`${G}/photos?limit=8`).set(auth(t.emp.token));
    assert.equal(all.body.meta.total, 2);
    assert.ok(new Date(all.body.data[0].createdAt) >= new Date(all.body.data[1].createdAt));
    const s = await api.get(`${G}/photos?q=front%20desk`).set(auth(t.emp.token));
    assert.equal(s.body.data.length, 1);
  });

  it('shows storage usage to HR/Admin only', async () => {
    const hr = await api.get(`${G}/stats`).set(auth(t.hr.token));
    assert.deepEqual({ albums: hr.body.data.albums, photos: hr.body.data.photos, recent: hr.body.data.recentUploads }, { albums: 3, photos: 2, recent: 2 });
    assert.ok(hr.body.data.storageBytes > 0);
    const emp = await api.get(`${G}/stats`).set(auth(t.emp.token));
    assert.equal(emp.body.data.storageBytes, undefined);
  });

  it('deletes a photo together with its stored files', async () => {
    const before1 = await files().countDocuments();
    const r = await api.delete(`${G}/photos/${photo.id}`).set(auth(t.hr.token));
    assert.equal(r.status, 200);
    assert.equal(await files().countDocuments(), before1 - 3);
    assert.equal((await fetchFile(photo.urls.thumb)).status, 404);
  });

  it('bulk-deletes photos', async () => {
    const a = await upload(t.hr.token, otherAlbumId);
    const b = await upload(t.hr.token, otherAlbumId);
    const bad = await api.post(`${G}/photos/bulk-delete`).set(auth(t.hr.token)).send({ ids: [] });
    assert.equal(bad.status, 422);
    const r = await api.post(`${G}/photos/bulk-delete`).set(auth(t.admin.token)).send({ ids: [a.body.data.id, b.body.data.id] });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.deleted, 2);
  });

  it('deleting an album removes all of its photos and files', async () => {
    await upload(t.hr.token, albumId);
    const r = await api.delete(`${G}/albums/${albumId}`).set(auth(t.admin.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.deletedPhotos, 2);
    assert.equal((await api.get(`${G}/photos?album=${albumId}`).set(auth(t.hr.token))).body.meta.total, 0);
    assert.equal(await files().countDocuments(), 0);
  });
});
