import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';
import { currentFyStart, fyLabel } from '../src/models/employeeDocOptions.js';

const PAL = '/api/v1/appraisal-letters';
const F16 = '/api/v1/form16';
const YEAR = new Date().getFullYear() - 1;
const FY = currentFyStart() - 1;
let t;

const pdf = (text = 'Doc') =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${text}`);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

/** multipart helper: fields + optional file */
const send = (method, url, token, fields = {}, file = pdf(), filename = 'doc.pdf') => {
  let r = api[method](url).set(auth(token));
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) r = r.field(k, String(v));
  return file ? r.attach('file', file, { filename, contentType: 'application/pdf' }) : r;
};
const download = (token, base, id, qs = '') => api.get(`${base}/${id}/download${qs}`).set(auth(token)).buffer(true).parse(binary);

before(async () => {
  await start();
  t = {
    admin: await login('admin@example.com'),
    hr: await login('hr@example.com'),
    manager: await login('ashu.taneja@bharuwasolutions.com'),
    emp: await login('shiva.karnwal@bharuwasolutions.com'),
    peer: await login('ishika.sahu@bharuwasolutions.com'),
  };
  // start from a clean slate (the seed adds demo documents for Shiva)
  await Promise.all(['appraisalletters', 'form16s'].map((c) => mongoose.connection.db.collection(c).deleteMany({})));
});
after(stop);

/* ======================= Performance Appraisal Letters ======================= */

describe('PAL: authentication & role checks', () => {
  it('requires a token everywhere', async () => {
    for (const p of [`${PAL}/my`, PAL, `${PAL}/options`, `${PAL}/${'a'.repeat(24)}`, `${PAL}/${'a'.repeat(24)}/download`]) {
      assert.equal((await api.get(p)).status, 401, p);
    }
  });
  it('employees and managers cannot list all, add, edit or delete', async () => {
    for (const who of [t.emp, t.manager]) {
      assert.equal((await api.get(PAL).set(auth(who.token))).status, 403);
      assert.equal((await send('post', PAL, who.token, { employee: t.emp.user.id, title: 'Mine', year: YEAR, month: 4 })).status, 403);
      assert.equal((await send('put', `${PAL}/${'a'.repeat(24)}`, who.token, { title: 'x' }, null)).status, 403);
      assert.equal((await api.delete(`${PAL}/${'a'.repeat(24)}`).set(auth(who.token))).status, 403);
    }
  });
});

let palId;
let palId2;
describe('PAL: HR/Admin CRUD', () => {
  it('validates input', async () => {
    const e = t.emp.user.id;
    const r = await send('post', PAL, t.hr.token, { employee: 'bad', title: 'ab', year: 1999, month: 13, appraisalType: 'nope', rating: 'great' });
    assert.equal(r.status, 422);
    for (const k of ['employee', 'title', 'year', 'month', 'appraisalType', 'rating']) assert.ok(r.body.errors[k], k);
    assert.equal((await send('post', PAL, t.hr.token, { employee: e, title: 'Annual', year: YEAR, month: 4 }, null)).status, 422); // no file
    const fake = await send('post', PAL, t.hr.token, { employee: e, title: 'Annual', year: YEAR, month: 4 }, Buffer.from('MZ not a pdf'));
    assert.equal(fake.status, 422);
    assert.ok(fake.body.errors.file);
    assert.equal((await send('post', PAL, t.hr.token, { employee: e, title: 'Annual', year: YEAR, month: 4 }, pdf(), 'x.exe')).status, 422);
    assert.equal((await send('post', PAL, t.hr.token, { employee: 'a'.repeat(24), title: 'Annual', year: YEAR, month: 4 })).status, 422);
    assert.equal((await send('post', PAL, t.hr.token, { employee: e, title: 'Annual', year: new Date().getFullYear() + 2, month: 4 })).status, 422);
  });
  it('adds a letter (encrypted at rest, no file bytes in JSON, audit fields set)', async () => {
    const r = await send('post', PAL, t.hr.token, { employee: t.emp.user.id, title: `Annual Appraisal ${YEAR}`, year: YEAR, month: 4, rating: 'exceeds', effectiveDate: `${YEAR}-04-01` }, pdf('PAL-A'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    palId = r.body.data.id;
    assert.equal(r.body.data.employee.name, 'Shiva Karnwal');
    assert.equal(r.body.data.uploadedBy.name, 'HR Manager');
    assert.equal(r.body.data.fileName, `Appraisal_Letter_1100175_Apr_${YEAR}.pdf`);
    assert.ok(r.body.data.createdAt && r.body.data.updatedAt);
    for (const k of ['data', 'iv', 'authTag']) assert.equal(r.body.data[k], undefined);
    const raw = await mongoose.connection.db.collection('appraisalletters').findOne({ _id: new mongoose.Types.ObjectId(palId) });
    assert.ok(!Buffer.from(raw.data.buffer ?? raw.data).includes(Buffer.from('%PDF-')));
  });
  it('blocks a duplicate employee/period/type with 409', async () => {
    const r = await send('post', PAL, t.admin.token, { employee: t.emp.user.id, title: 'Again', year: YEAR, month: 4 });
    assert.equal(r.status, 409);
    const other = await send('post', PAL, t.admin.token, { employee: t.emp.user.id, title: 'Mid-year', year: YEAR, month: 10, appraisalType: 'mid_year' });
    assert.equal(other.status, 201);
    palId2 = other.body.data.id;
  });
  it('lists with search, year/month filters and pagination', async () => {
    const all = await api.get(PAL).query({ q: 'karnwal' }).set(auth(t.hr.token));
    assert.equal(all.body.meta.total, 2);
    assert.equal((await api.get(PAL).query({ q: '1100175', month: 10 }).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(PAL).query({ year: YEAR - 5 }).set(auth(t.hr.token))).body.meta.total, 0);
    const paged = await api.get(PAL).query({ limit: 1, page: 2 }).set(auth(t.hr.token));
    assert.equal(paged.body.data.length, 1);
    assert.equal(paged.body.meta.pages, 2);
  });
  it('edits metadata and replaces the file', async () => {
    let r = await send('put', `${PAL}/${palId}`, t.hr.token, { title: 'Annual Appraisal (revised)', rating: '' }, null);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.title, 'Annual Appraisal (revised)');
    assert.equal(r.body.data.rating, '');
    r = await send('put', `${PAL}/${palId}`, t.hr.token, {}, pdf('PAL-B'));
    assert.equal(r.status, 200);
    assert.ok(r.body.data.fileReplacedAt);
    const d = await download(t.emp.token, PAL, palId);
    assert.ok(d.body.includes(Buffer.from('PAL-B')));
    assert.equal((await send('put', `${PAL}/${palId2}`, t.hr.token, { month: 4, appraisalType: 'annual' }, null)).status, 409);
  });
});

describe('PAL: employees see only their own letters', () => {
  it('"my" is scoped to the caller with year/month filters', async () => {
    const mine = await api.get(`${PAL}/my`).set(auth(t.emp.token));
    assert.equal(mine.body.data.length, 2);
    assert.deepEqual(mine.body.meta.years, [YEAR]);
    assert.equal((await api.get(`${PAL}/my`).query({ month: 10 }).set(auth(t.emp.token))).body.data.length, 1);
    const peer = await api.get(`${PAL}/my`).query({ employee: t.emp.user.id }).set(auth(t.peer.token));
    assert.equal(peer.body.data.length, 0);
  });
  it('owner can view/download; anyone else (incl. managers) gets 404', async () => {
    assert.equal((await api.get(`${PAL}/${palId}`).set(auth(t.emp.token))).status, 200);
    const d = await download(t.emp.token, PAL, palId);
    assert.equal(d.status, 200);
    assert.equal(d.headers['content-type'], 'application/pdf');
    assert.match(d.headers['content-disposition'], /^attachment/);
    assert.match(d.headers['cache-control'], /no-store/);
    for (const who of [t.peer, t.manager]) {
      assert.equal((await api.get(`${PAL}/${palId}`).set(auth(who.token))).status, 404);
      assert.equal((await download(who.token, PAL, palId)).status, 404);
    }
    assert.equal((await api.get(`${PAL}/not-an-id`).set(auth(t.emp.token))).status, 404);
  });
  it('HR deletes; the letter is gone for everyone', async () => {
    assert.equal((await api.delete(`${PAL}/${palId2}`).set(auth(t.hr.token))).status, 200);
    assert.equal((await api.get(`${PAL}/${palId2}`).set(auth(t.emp.token))).status, 404);
    assert.equal((await api.delete(`${PAL}/${palId2}`).set(auth(t.hr.token))).status, 404);
  });
});

/* ======================= Form 16 Part A / Part B ======================= */

let partA;
let partB;
describe('Form 16', () => {
  it('only HR/Admin can add, edit, delete or list all', async () => {
    for (const who of [t.emp, t.manager]) {
      assert.equal((await send('post', F16, who.token, { employee: who.user.id, part: 'A', fyStart: FY })).status, 403);
      assert.equal((await api.get(F16).set(auth(who.token))).status, 403);
      assert.equal((await api.delete(`${F16}/${'a'.repeat(24)}`).set(auth(who.token))).status, 403);
    }
  });
  it('validates part, financial year and TAN', async () => {
    const r = await send('post', F16, t.hr.token, { employee: t.emp.user.id, part: 'C', fyStart: 'x', employerTan: 'BAD' });
    assert.equal(r.status, 422);
    for (const k of ['part', 'fyStart', 'employerTan']) assert.ok(r.body.errors[k], k);
    const future = await send('post', F16, t.hr.token, { employee: t.emp.user.id, part: 'A', fyStart: currentFyStart() + 1 });
    assert.equal(future.status, 422);
    assert.ok(future.body.errors.fyStart);
  });
  it('adds Part A and Part B separately; one of each per FY', async () => {
    const a = await send('post', F16, t.hr.token, { employee: t.emp.user.id, part: 'A', fyStart: FY, certificateNo: 'ABC123', employerTan: 'ABCD12345E' }, pdf('F16-A'));
    assert.equal(a.status, 201, JSON.stringify(a.body));
    partA = a.body.data.id;
    assert.equal(a.body.data.financialYear, fyLabel(FY));
    assert.equal(a.body.data.assessmentYear, fyLabel(FY + 1));
    assert.equal(a.body.data.employerTan, 'ABCD12345E');
    assert.equal(a.body.data.fileName, `Form16_PartA_1100175_FY${fyLabel(FY)}.pdf`);
    const b = await send('post', F16, t.admin.token, { employee: t.emp.user.id, part: 'B', fyStart: FY }, pdf('F16-B'));
    assert.equal(b.status, 201);
    partB = b.body.data.id;
    assert.equal((await send('post', F16, t.hr.token, { employee: t.emp.user.id, part: 'A', fyStart: FY })).status, 409);
  });
  it('filters by part and financial year', async () => {
    assert.equal((await api.get(F16).query({ part: 'A' }).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(F16).query({ part: 'B', fyStart: FY }).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(F16).query({ q: 'ABC123' }).set(auth(t.hr.token))).body.meta.total, 1);
    const mine = await api.get(`${F16}/my`).query({ part: 'B' }).set(auth(t.emp.token));
    assert.equal(mine.body.data.length, 1);
    assert.deepEqual(mine.body.meta.partCounts, { A: 1, B: 1 });
    assert.equal(mine.body.meta.financialYears[0].value, FY);
  });
  it('edits each part independently', async () => {
    const r = await send('put', `${F16}/${partB}`, t.hr.token, { remarks: 'Corrected 80C', issueDate: `${FY + 1}-06-15` }, pdf('F16-B2'));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.remarks, 'Corrected 80C');
    const d = await download(t.emp.token, F16, partB);
    assert.ok(d.body.includes(Buffer.from('F16-B2')));
    assert.ok((await download(t.emp.token, F16, partA)).body.includes(Buffer.from('F16-A')));
    assert.equal((await send('put', `${F16}/${partB}`, t.hr.token, { part: 'A' }, null)).status, 409);
  });
  it('another employee can never reach these documents', async () => {
    assert.equal((await api.get(`${F16}/my`).set(auth(t.peer.token))).body.data.length, 0);
    for (const id of [partA, partB]) {
      assert.equal((await api.get(`${F16}/${id}`).set(auth(t.peer.token))).status, 404);
      assert.equal((await download(t.peer.token, F16, id)).status, 404);
      assert.equal((await download(t.manager.token, F16, id)).status, 404);
    }
  });
  it('deletes Part A without touching Part B', async () => {
    assert.equal((await api.delete(`${F16}/${partA}`).set(auth(t.admin.token))).status, 200);
    assert.equal((await api.get(`${F16}/${partA}`).set(auth(t.emp.token))).status, 404);
    assert.equal((await api.get(`${F16}/${partB}`).set(auth(t.emp.token))).status, 200);
  });
});
