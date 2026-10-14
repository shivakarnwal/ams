import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';

const P = '/api/v1/policies';
let t;
const pdf = (text = 'Policy') =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${text}`);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const files = () => mongoose.connection.db.collection('policyFiles.files');

const upload = (token, fields, { file = pdf('v1'), filename = 'leave-policy.pdf' } = {}) => {
  let r = api.post(P).set(auth(token));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return file ? r.attach('file', file, { filename }) : r;
};
const addVersion = (token, id, fields = {}, file = pdf('v2'), filename = 'leave-policy-v2.pdf') => {
  let r = api.post(`${P}/${id}/versions`).set(auth(token));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename });
};

let folderId;
let policyId;

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

describe('policies: access control', () => {
  it('requires a token', async () => {
    assert.equal((await api.get(`${P}/categories`)).status, 401);
    assert.equal((await api.get(P)).status, 401);
  });

  it('HR creates folders; names are unique (case-insensitive)', async () => {
    const r = await api.post(`${P}/categories`).set(auth(t.hr.token)).send({ name: 'Leave Policies', color: 'purple' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    folderId = r.body.data.id;
    assert.equal((await api.post(`${P}/categories`).set(auth(t.admin.token)).send({ name: 'leave policies' })).status, 409);
    assert.equal((await api.post(`${P}/categories`).set(auth(t.hr.token)).send({ name: 'X', color: 'neon' })).status, 422);
  });

  it('employees and managers are read-only', async () => {
    for (const who of [t.emp, t.manager]) {
      assert.equal((await api.get(`${P}/categories`).set(auth(who.token))).status, 200);
      assert.equal((await api.post(`${P}/categories`).set(auth(who.token)).send({ name: 'Mine' })).status, 403);
      assert.equal((await upload(who.token, { title: 'Sneaky', category: folderId })).status, 403);
    }
    assert.equal(await files().countDocuments(), 0, 'rejected uploads must store nothing');
  });
});

describe('policies: upload, versions, download', () => {
  it('validates the document by content and extension', async () => {
    const base = { title: 'Leave Policy', category: folderId };
    assert.equal((await upload(t.hr.token, base, { file: null })).status, 422);
    assert.equal((await upload(t.hr.token, base, { file: Buffer.from('MZ not a document'), filename: 'x.pdf' })).status, 422);
    assert.equal((await upload(t.hr.token, base, { file: pdf(), filename: 'x.exe' })).status, 422);
    assert.equal((await upload(t.hr.token, { ...base, category: 'a'.repeat(24) })).status, 422);
    assert.equal(await files().countDocuments(), 0);
  });

  it('uploads a policy as version 1.0', async () => {
    const r = await upload(t.hr.token, { title: 'Leave Policy', category: folderId, description: 'Annual, sick and casual leave', effectiveDate: '2026-04-01' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    policyId = r.body.data.id;
    assert.equal(r.body.data.currentVersion.version, '1.0');
    assert.equal(r.body.data.versionCount, 1);
    assert.equal(r.body.data.category.name, 'Leave Policies');
    assert.equal(r.body.data.currentVersion.fileId, undefined, 'storage ids must not leak');
    assert.equal((await upload(t.admin.token, { title: 'leave policy', category: folderId })).status, 409, 'duplicate title in folder');
  });

  it('everyone can download; inline preview for PDFs', async () => {
    const r = await api.get(`${P}/${policyId}/download`).set(auth(t.emp.token)).buffer(true).parse(binary);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.match(r.headers['content-disposition'], /^attachment; filename="Leave Policy v1\.0\.pdf"/);
    assert.ok(r.body.equals(pdf('v1')));
    const inline = await api.get(`${P}/${policyId}/download?inline=true`).set(auth(t.manager.token));
    assert.match(inline.headers['content-disposition'], /^inline/);
  });

  it('replacing adds a version and keeps history', async () => {
    assert.equal((await addVersion(t.emp.token, policyId)).status, 403);
    const r = await addVersion(t.hr.token, policyId, { version: '2.0', changeNote: 'Added WFH leave', effectiveDate: '2026-10-01' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.currentVersion.version, '2.0');
    assert.equal(r.body.data.versionCount, 2);
    assert.equal(r.body.data.effectiveDate.slice(0, 10), '2026-10-01');
    assert.equal((await addVersion(t.hr.token, policyId, { version: '2.0' })).status, 409, 'duplicate version label');
    assert.equal((await addVersion(t.hr.token, policyId, { version: 'bad/label' })).status, 422);

    const detail = await api.get(`${P}/${policyId}`).set(auth(t.emp.token));
    assert.deepEqual(detail.body.data.versions.map((v) => v.version), ['2.0', '1.0']);
    const old = detail.body.data.versions[1];
    const r1 = await api.get(`${P}/${policyId}/download?version=${old.id}`).set(auth(t.emp.token)).buffer(true).parse(binary);
    assert.ok(r1.body.equals(pdf('v1')), 'older versions stay downloadable');
    const cur = await api.get(`${P}/${policyId}/download`).set(auth(t.emp.token)).buffer(true).parse(binary);
    assert.ok(cur.body.equals(pdf('v2')));
  });

  it('auto-numbers versions when no label is given', async () => {
    const r = await addVersion(t.admin.token, policyId);
    assert.equal(r.body.data.currentVersion.version, '3.0');
  });

  it('protects the current version; deletes old ones with their files', async () => {
    const detail = await api.get(`${P}/${policyId}`).set(auth(t.hr.token));
    const [current, , oldest] = detail.body.data.versions;
    assert.equal((await api.delete(`${P}/${policyId}/versions/${current.id}`).set(auth(t.hr.token))).status, 409);
    assert.equal((await api.delete(`${P}/${policyId}/versions/${oldest.id}`).set(auth(t.emp.token))).status, 403);
    const before1 = await files().countDocuments();
    assert.equal((await api.delete(`${P}/${policyId}/versions/${oldest.id}`).set(auth(t.hr.token))).status, 200);
    assert.equal(await files().countDocuments(), before1 - 1);
  });

  it('edits metadata, lists, searches and reports folder stats', async () => {
    assert.equal((await api.patch(`${P}/${policyId}`).set(auth(t.emp.token)).send({ title: 'Hack' })).status, 403);
    const r = await api.patch(`${P}/${policyId}`).set(auth(t.hr.token)).send({ title: 'Leave & Holiday Policy' });
    assert.equal(r.status, 200);
    const list = await api.get(`${P}?q=holiday`).set(auth(t.emp.token));
    assert.equal(list.body.meta.total, 1);
    const cats = await api.get(`${P}/categories`).set(auth(t.emp.token));
    const folder = cats.body.data.find((c) => c.id === folderId);
    assert.equal(folder.policyCount, 1);
    assert.ok(folder.totalSize > 0);
    const s = await api.get(`${P}/stats`).set(auth(t.emp.token));
    assert.equal(s.body.data.files, 1);
  });

  it('a folder with policies cannot be deleted; deleting a policy removes all files', async () => {
    assert.equal((await api.delete(`${P}/categories/${folderId}`).set(auth(t.hr.token))).status, 409);
    assert.equal((await api.delete(`${P}/${policyId}`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.delete(`${P}/${policyId}`).set(auth(t.admin.token))).status, 200);
    assert.equal(await files().countDocuments(), 0);
    assert.equal((await api.delete(`${P}/categories/${folderId}`).set(auth(t.hr.token))).status, 200);
  });
});
