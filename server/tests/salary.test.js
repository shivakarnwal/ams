import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';

const P = '/api/v1/salary-slips';
const YEAR = new Date().getFullYear() - 1; // always in the past
let t;
const pdf = (text = 'Salary') =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${text}`);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const upload = (token, { employee, month = 8, year = YEAR, file = pdf('A'), filename = 'slip.pdf', note } = {}) => {
  let r = api.post(P).set(auth(token)).field('employee', employee).field('month', String(month)).field('year', String(year));
  if (note) r = r.field('note', note);
  return file ? r.attach('file', file, { filename, contentType: 'application/pdf' }) : r;
};
const get = (token, id, qs = '') => api.get(`${P}/${id}/download${qs}`).set(auth(token)).buffer(true).parse(binary);
const raw = () => mongoose.connection.db.collection('salaryslips');

let slipId;

before(async () => {
  await start();
  t = {
    admin: await login('admin@example.com'),
    hr: await login('hr@example.com'),
    manager: await login('ashu.taneja@bharuwasolutions.com'),
    emp: await login('shiva.karnwal@bharuwasolutions.com'),
    peer: await login('ishika.sahu@bharuwasolutions.com'),
  };
});
after(stop);

describe('authentication & authorization', () => {
  it('requires a token everywhere', async () => {
    assert.equal((await api.get(`${P}/my`)).status, 401);
    assert.equal((await api.get(P)).status, 401);
    assert.equal((await api.get(`${P}/${'a'.repeat(24)}/download`)).status, 401);
  });
  it('employees and managers cannot upload or list all slips', async () => {
    for (const who of [t.emp, t.manager]) {
      assert.equal((await upload(who.token, { employee: t.emp.user.id })).status, 403);
      assert.equal((await api.get(P).set(auth(who.token))).status, 403);
    }
  });
});

describe('upload (HR/Admin)', () => {
  it('rejects bad input with field errors', async () => {
    const e = t.emp.user.id;
    assert.equal((await upload(t.hr.token, { employee: e, file: null })).status, 422); // no file
    const fake = await upload(t.hr.token, { employee: e, file: Buffer.from('MZ not a pdf at all') });
    assert.equal(fake.status, 422);
    assert.ok(fake.body.errors.file);
    assert.equal((await upload(t.hr.token, { employee: e, filename: 'malware.exe' })).status, 422);
    assert.equal((await upload(t.hr.token, { employee: e, month: 13 })).status, 422);
    assert.equal((await upload(t.hr.token, { employee: e, year: new Date().getFullYear() + 1 })).status, 422);
    assert.equal((await upload(t.hr.token, { employee: 'not-an-id' })).status, 422);
    assert.equal((await upload(t.hr.token, { employee: 'a'.repeat(24) })).status, 422);
    const big = await upload(t.hr.token, { employee: e, file: Buffer.concat([pdf(), Buffer.alloc(1.2 * 1024 * 1024)]) });
    assert.equal(big.status, 413);
  });
  it('uploads a slip, never exposes file bytes in JSON, and stores it encrypted', async () => {
    const original = pdf('A');
    const r = await upload(t.hr.token, { employee: t.emp.user.id, file: original, note: 'August payroll' });
    assert.equal(r.status, 201);
    slipId = r.body.data.id;
    assert.equal(r.body.data.fileName, `Salary_Slip_1100175_Aug_${YEAR}.pdf`);
    assert.equal(r.body.data.employee.name, 'Shiva Karnwal');
    for (const k of ['data', 'iv', 'authTag']) assert.equal(r.body.data[k], undefined);

    const doc = await raw().findOne({ _id: new mongoose.Types.ObjectId(slipId) });
    const stored = Buffer.from(doc.data.buffer ?? doc.data);
    assert.ok(!stored.includes(Buffer.from('%PDF-')), 'file must not be stored in plaintext');
    assert.equal(Buffer.from(doc.iv.buffer ?? doc.iv).length, 12);
    assert.equal(doc.checksum, crypto.createHash('sha256').update(original).digest('hex'));
  });
  it('blocks a duplicate employee/month/year with 409', async () => {
    const r = await upload(t.hr.token, { employee: t.emp.user.id });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /already exists/);
    assert.equal((await upload(t.admin.token, { employee: t.emp.user.id, month: 9 })).status, 201); // admin may upload too
  });
});

describe('employee access (own slips only)', () => {
  it('lists only own slips month-wise with available years', async () => {
    const r = await api.get(`${P}/my`).set(auth(t.emp.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
    assert.deepEqual(r.body.data.map((s) => s.month), [9, 8]); // newest first
    assert.deepEqual(r.body.meta.years, [YEAR]);
    assert.equal((await api.get(`${P}/my?year=${YEAR - 5}`).set(auth(t.emp.token))).body.data.length, 0);
    assert.equal((await api.get(`${P}/my`).set(auth(t.peer.token))).body.data.length, 0);
    assert.equal((await api.get(`${P}/my?year=abc`).set(auth(t.emp.token))).status, 422);
  });
  it('downloads own slip as a PDF with safe headers; bytes match the upload', async () => {
    const r = await get(t.emp.token, slipId);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.match(r.headers['content-disposition'], /^attachment; filename="Salary_Slip_1100175_Aug_\d{4}\.pdf"$/);
    assert.match(r.headers['cache-control'], /no-store/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.body.equals(pdf('A')));
    assert.match((await get(t.emp.token, slipId, '?inline=true')).headers['content-disposition'], /^inline;/);
  });
  it("cannot see anyone else's slip (404, same as a missing one)", async () => {
    const missing = await get(t.peer.token, 'b'.repeat(24));
    for (const who of [t.peer, t.manager]) {
      const meta = await api.get(`${P}/${slipId}`).set(auth(who.token));
      assert.equal(meta.status, 404);
      assert.equal(meta.body.message, 'Salary slip not found');
      const dl = await get(who.token, slipId);
      assert.equal(dl.status, 404);
      assert.equal(dl.status, missing.status);
    }
    assert.equal((await api.get(`${P}/${slipId}`).set(auth(t.emp.token))).status, 200);
    assert.equal((await api.get(`${P}/not-an-id`).set(auth(t.emp.token))).status, 400);
  });
  it('cannot modify or delete', async () => {
    assert.equal((await api.delete(`${P}/${slipId}`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.put(`${P}/${slipId}`).set(auth(t.emp.token)).attach('file', pdf('X'), 'x.pdf')).status, 403);
  });
  it('HR/Admin can download any slip', async () => {
    assert.equal((await get(t.hr.token, slipId)).status, 200);
    assert.equal((await get(t.admin.token, slipId)).status, 200);
    const meta = await api.get(`${P}/${slipId}`).set(auth(t.hr.token));
    assert.ok(meta.body.data.downloadCount >= 1);
  });
});

describe('management list (HR/Admin)', () => {
  it('filters by employee, period and name/code, with pagination', async () => {
    await upload(t.hr.token, { employee: t.peer.user.id, month: 8 });
    const all = await api.get(`${P}?limit=2`).set(auth(t.hr.token));
    assert.equal(all.body.meta.total, 3);
    assert.equal(all.body.data.length, 2);
    assert.equal((await api.get(`${P}?employee=${t.emp.user.id}`).set(auth(t.hr.token))).body.meta.total, 2);
    assert.equal((await api.get(`${P}?month=8&year=${YEAR}`).set(auth(t.hr.token))).body.meta.total, 2);
    assert.equal((await api.get(`${P}?q=ishika`).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(`${P}?q=1100175`).set(auth(t.hr.token))).body.meta.total, 2);
    assert.equal((await api.get(`${P}?employee[$ne]=x`).set(auth(t.hr.token))).status, 400);
    assert.equal((await api.get(`${P}?month=15`).set(auth(t.hr.token))).status, 422);
  });
});

describe('replace', () => {
  it('replaces the file in place (same id) and keeps the old file if the new one is invalid', async () => {
    const bad = await api.put(`${P}/${slipId}`).set(auth(t.hr.token)).attach('file', Buffer.from('nope'), { filename: 'a.pdf', contentType: 'application/pdf' });
    assert.equal(bad.status, 422);
    assert.ok((await get(t.emp.token, slipId)).body.equals(pdf('A')));
    assert.equal((await api.put(`${P}/${slipId}`).set(auth(t.hr.token))).status, 422); // no file

    const r = await api.put(`${P}/${slipId}`).set(auth(t.hr.token)).field('note', 'Corrected').attach('file', pdf('B-corrected'), { filename: 'new.pdf', contentType: 'application/pdf' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.id, slipId);
    assert.equal(r.body.data.note, 'Corrected');
    assert.ok(r.body.data.replacedAt);
    assert.equal(r.body.data.updatedBy.name, 'HR Manager');
    assert.ok((await get(t.emp.token, slipId)).body.equals(pdf('B-corrected')));
    assert.equal((await api.get(`${P}/my`).set(auth(t.emp.token))).body.data.length, 2); // no duplicate created
  });
});

describe('integrity', () => {
  it('refuses to serve a blob that was copied onto another record', async () => {
    const other = (await api.get(`${P}/my`).set(auth(t.emp.token))).body.data.find((s) => s.id !== slipId);
    const src = await raw().findOne({ _id: new mongoose.Types.ObjectId(slipId) });
    await raw().updateOne({ _id: new mongoose.Types.ObjectId(other.id) }, { $set: { data: src.data, iv: src.iv, authTag: src.authTag } });
    const r = await get(t.emp.token, other.id);
    assert.equal(r.status, 500);
  });
});

describe('delete & cascade', () => {
  it('HR deletes a slip; it disappears for the employee', async () => {
    assert.equal((await api.delete(`${P}/${slipId}`).set(auth(t.hr.token))).status, 200);
    assert.equal((await api.get(`${P}/${slipId}`).set(auth(t.emp.token))).status, 404);
    assert.equal((await get(t.hr.token, slipId)).status, 404);
    assert.equal((await api.delete(`${P}/${slipId}`).set(auth(t.hr.token))).status, 404);
    assert.equal((await api.get(`${P}/my`).set(auth(t.emp.token))).body.data.length, 1);
    assert.equal((await upload(t.hr.token, { employee: t.emp.user.id })).status, 201); // period is free again
  });
  it("deleting an employee removes their slips", async () => {
    const c = await api.post('/api/v1/employees').set(auth(t.admin.token)).send({ employeeCode: 'E7001', name: 'Temp Person', email: 'temp.person@x.com', password: 'Secret123' });
    assert.equal(c.status, 201);
    assert.equal((await upload(t.hr.token, { employee: c.body.data.id, month: 1 })).status, 201);
    assert.equal(await raw().countDocuments({ employee: new mongoose.Types.ObjectId(c.body.data.id) }), 1);
    assert.equal((await api.delete(`/api/v1/employees/${c.body.data.id}`).set(auth(t.admin.token))).status, 200);
    assert.equal(await raw().countDocuments({ employee: new mongoose.Types.ObjectId(c.body.data.id) }), 0);
  });
});
