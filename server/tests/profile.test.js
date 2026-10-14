import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';

const P = '/api/v1/profiles';
let t;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const raw = () => mongoose.connection.db.collection('employeeprofiles');

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

describe('profiles: who can see what', () => {
  it('requires a token', async () => {
    assert.equal((await api.get(`${P}/me`)).status, 401);
  });

  it('employees get their own profile with read-only restricted sections', async () => {
    const r = await api.get(`${P}/me`).set(auth(t.emp.token));
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.equal(d.user.employeeCode, '1100175');
    assert.equal(d.isSelf, true);
    assert.deepEqual(
      { general: d.permissions.general, bank: d.permissions.bank, statutory: d.permissions.statutory, contact: d.permissions.contact, family: d.permissions.family },
      { general: 'view', bank: 'view', statutory: 'view', contact: 'edit', family: 'edit' },
    );
    assert.equal(d.employment.grade, 'E120');
    assert.equal(d.employment.hod.name, 'Ashu Taneja');
  });

  it('sensitive values are masked and never leave as ciphertext', async () => {
    const d = (await api.get(`${P}/me`).set(auth(t.emp.token))).body.data;
    assert.equal(d.bank.accountNumber, 'XXXX XXXX 2222');
    assert.equal(d.statutory.panNo, 'XXXX XX 234F');
    assert.ok(d.bank.revealable.includes('accountNumber'));
    assert.ok(!JSON.stringify(d).includes('v1:'), 'ciphertext must not be returned');
    const stored = await raw().findOne({ user: new mongoose.Types.ObjectId(t.emp.user.id) });
    assert.match(stored.bank.accountNumber, /^v1:/, 'stored encrypted');
    assert.ok(!JSON.stringify(stored).includes('000011112222'));
  });

  it("other people's profiles are invisible to employees and managers (404)", async () => {
    assert.equal((await api.get(`${P}/${t.emp.user.id}`).set(auth(t.peer.token))).status, 404);
    assert.equal((await api.get(`${P}/${t.emp.user.id}`).set(auth(t.manager.token))).status, 404, 'even the reporting manager');
    assert.equal((await api.post(`${P}/${t.emp.user.id}/reveal`).set(auth(t.peer.token)).send({ field: 'accountNumber' })).status, 404);
    assert.equal((await api.get(`${P}/not-an-id`).set(auth(t.hr.token))).status, 400);
  });

  it('HR and Admin can open any profile with edit rights everywhere', async () => {
    const r = await api.get(`${P}/${t.emp.user.id}`).set(auth(t.hr.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.isSelf, false);
    assert.ok(Object.values(r.body.data.permissions).every((x) => x === 'edit'), 'HR may edit an employee profile');
    assert.equal((await api.get(`${P}/${t.emp.user.id}`).set(auth(t.admin.token))).status, 200);
  });

  it('reveal returns the full value to the owner and is audited', async () => {
    const r = await api.post(`${P}/me/reveal`).set(auth(t.emp.token)).send({ field: 'accountNumber' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.value, '000011112222');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal((await api.post(`${P}/me/reveal`).set(auth(t.emp.token)).send({ field: 'password' })).status, 422);
    const h = await api.get(`${P}/me/history`).set(auth(t.emp.token));
    assert.ok(h.body.data.some((e) => e.action === 'reveal' && e.fields.includes('accountNumber')));
  });
});

describe('profiles: restricted sections (HR/Admin only)', () => {
  it('employees cannot change personal, bank or statutory details — even via the API', async () => {
    const id = t.emp.user.id;
    assert.equal((await api.put(`${P}/me/general`).set(auth(t.emp.token)).send({ firstName: 'Hacker' })).status, 403);
    assert.equal((await api.put(`${P}/${id}/bank`).set(auth(t.emp.token)).send({ accountNumber: '123456789' })).status, 403);
    assert.equal((await api.put(`${P}/me/statutory`).set(auth(t.emp.token)).send({ panNo: 'ZZZZZ9999Z' })).status, 403);
    assert.equal((await api.put(`${P}/me/documents/pan`).set(auth(t.emp.token)).attach('file', PDF, 'pan.pdf')).status, 403);
    assert.equal((await api.put(`${P}/me/general`).set(auth(t.manager.token)).send({ firstName: 'X' })).status, 403);
    // the legacy self-service endpoint is locked down the same way
    assert.equal((await api.put('/api/v1/auth/profile').set(auth(t.emp.token)).send({ name: 'Someone Else' })).status, 403);
    assert.equal((await api.put('/api/v1/auth/profile').set(auth(t.emp.token)).send({ dateOfBirth: '1990-01-01' })).status, 403);
    const d = (await api.get(`${P}/me`).set(auth(t.emp.token))).body.data;
    assert.equal(d.user.name, 'Shiva Karnwal');
    assert.equal(d.bank.accountNumber, 'XXXX XXXX 2222');
  });

  it('HR updates personal + employment details; the display name follows', async () => {
    const r = await api.put(`${P}/${t.emp.user.id}/general`).set(auth(t.hr.token)).send({
      firstName: 'Shiva', middleName: 'Kumar', lastName: 'Karnwal', bloodGroup: 'O+', maritalStatus: 'Married',
      dateOfBirth: '1997-10-16', grade: 'E130', designation: 'Senior Engineer', hod: t.manager.user.id, shiftStart: '09:00', shiftEnd: '18:00',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.user.name, 'Shiva Kumar Karnwal');
    assert.equal(r.body.data.user.designation, 'Senior Engineer');
    assert.equal(r.body.data.general.bloodGroup, 'O+');
    assert.equal(r.body.data.employment.grade, 'E130');
    assert.equal(r.body.data.sectionMeta.general.updatedBy.name, 'HR Manager');
  });

  it('validates input and rejects unknown keys', async () => {
    const id = t.emp.user.id;
    assert.equal((await api.put(`${P}/${id}/general`).set(auth(t.hr.token)).send({ bloodGroup: 'Z+' })).status, 422);
    assert.equal((await api.put(`${P}/${id}/general`).set(auth(t.hr.token)).send({ role: 'admin' })).status, 422, 'unknown key');
    assert.equal((await api.put(`${P}/${id}/general`).set(auth(t.hr.token)).send({ hod: id })).status, 422, 'cannot be own HOD');
    assert.equal((await api.put(`${P}/${id}/bank`).set(auth(t.hr.token)).send({ ifsc: 'BAD' })).status, 422);
    assert.equal((await api.put(`${P}/${id}/bank`).set(auth(t.hr.token)).send({ accountNumber: '12ab' })).status, 422);
    assert.equal((await api.put(`${P}/${id}/statutory`).set(auth(t.hr.token)).send({ aadhaarNo: '1234' })).status, 422);
  });

  it('HR updates bank details: omit keeps the secret, a value replaces it, "" clears it', async () => {
    const id = t.emp.user.id;
    let r = await api.put(`${P}/${id}/bank`).set(auth(t.hr.token)).send({ bankName: 'HDFC Bank', ifsc: 'hdfc0000123' });
    assert.equal(r.body.data.bank.accountNumber, 'XXXX XXXX 2222', 'omitted secret is kept');
    assert.equal(r.body.data.bank.ifsc, 'HDFC0000123', 'IFSC normalised to upper case');
    r = await api.put(`${P}/${id}/bank`).set(auth(t.admin.token)).send({ accountNumber: '50100123456789' });
    assert.equal(r.body.data.bank.accountNumber, 'XXXX XXXX XX 6789');
    r = await api.put(`${P}/${id}/statutory`).set(auth(t.hr.token)).send({ passportNo: 'p1234567', uanNo: '100000000002' });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.statutory.revealable.includes('passportNo'));
    r = await api.put(`${P}/${id}/statutory`).set(auth(t.hr.token)).send({ passportNo: '' });
    assert.ok(!r.body.data.statutory.revealable.includes('passportNo'), 'cleared');
    const h = (await api.get(`${P}/${id}/history`).set(auth(t.hr.token))).body.data;
    const bankEvents = h.filter((e) => e.section === 'bank' && e.action === 'update');
    assert.ok(bankEvents.some((e) => e.fields.includes('accountNumber')));
    assert.ok(!JSON.stringify(h).includes('50100123456789'), 'audit never stores values');
  });

  it('separation of duties: HR cannot change its own (or another HR/Admin) HR-managed data; Admin can', async () => {
    assert.equal((await api.put(`${P}/me/bank`).set(auth(t.hr.token)).send({ accountNumber: '111122223333' })).status, 403);
    assert.equal((await api.put(`${P}/${t.admin.user.id}/general`).set(auth(t.hr.token)).send({ firstName: 'X' })).status, 403);
    const own = (await api.get(`${P}/me`).set(auth(t.hr.token))).body.data.permissions;
    assert.equal(own.bank, 'view');
    assert.equal(own.contact, 'edit', 'own self-service sections stay editable');
    assert.equal((await api.put(`${P}/${t.hr.user.id}/bank`).set(auth(t.admin.token)).send({ bankName: 'SBI', accountNumber: '111122223333' })).status, 200);
  });

  it('HR uploads and removes identity documents; the employee can download them', async () => {
    const id = t.emp.user.id;
    assert.equal((await api.put(`${P}/${id}/documents/pan`).set(auth(t.hr.token)).attach('file', Buffer.from('MZ'), 'pan.exe')).status, 422);
    const r = await api.put(`${P}/${id}/documents/pan`).set(auth(t.hr.token)).attach('file', PDF, 'pan.pdf');
    assert.equal(r.status, 200);
    const f = r.body.data.documents.find((d) => d.type === 'pan').file;
    const dl = await api.get(`${P}/me/files/${f.id}`).set(auth(t.emp.token));
    assert.equal(dl.status, 200);
    assert.equal((await api.get(`${P}/${id}/files/${f.id}`).set(auth(t.peer.token))).status, 404);
    assert.equal((await api.delete(`${P}/${id}/documents/pan`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.delete(`${P}/${id}/documents/pan`).set(auth(t.hr.token))).status, 200);
  });
});

describe('profiles: self-service sections', () => {
  it('employees update their own contact details', async () => {
    const r = await api.put(`${P}/me/contact`).set(auth(t.emp.token)).send({
      personalEmail: 'shiva@example.com', emergencyContactPerson: 'Ram Karnwal', emergencyContactNo: '9876500000',
      permanentAddress: { line1: '12 Ganga Vihar', city: 'Haridwar', state: 'Uttarakhand', pincode: '249401', country: 'India' },
      sameAsPermanent: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.contact.correspondenceAddress.line1, '12 Ganga Vihar', 'same-as-above copies the address');
    assert.equal((await api.put(`${P}/me/contact`).set(auth(t.emp.token)).send({ permanentAddress: { pincode: '12' } })).status, 422);
    assert.equal((await api.put(`${P}/me/contact`).set(auth(t.emp.token)).send({ bank: { accountNumber: '1' } })).status, 422, 'no smuggling');
    assert.equal((await api.put(`${P}/${t.emp.user.id}/contact`).set(auth(t.peer.token)).send({ personalEmail: 'x@y.z' })).status, 404);
  });

  it('adds, edits and removes experience with an attachment', async () => {
    const bad = await api.post(`${P}/me/experience`).set(auth(t.emp.token)).send({ employer: 'Acme', designation: 'Intern', fromDate: '2021-06-01', toDate: '2021-01-01' });
    assert.equal(bad.status, 422);
    const r = await api.post(`${P}/me/experience`).set(auth(t.emp.token))
      .field('employer', 'Acme Corp').field('designation', 'Intern').field('fromDate', '2021-01-01').field('toDate', '2022-01-01')
      .attach('attachment', PDF, 'relieving-letter.pdf');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const row = r.body.data.experience[0];
    assert.equal(row.attachment.fileName, 'relieving-letter.pdf');
    assert.equal(r.body.data.summary.previousCompanies, 1);
    assert.equal(r.body.data.summary.previousExperienceMonths, 12);
    const e = await api.put(`${P}/me/experience/${row.id}`).set(auth(t.emp.token)).send({ employer: 'Acme Corporation', designation: 'Intern', fromDate: '2021-01-01', toDate: '2022-01-01', removeAttachment: true });
    assert.equal(e.status, 200);
    assert.equal(e.body.data.experience[0].employer, 'Acme Corporation');
    assert.equal(e.body.data.experience[0].attachment, null);
    assert.equal((await api.delete(`${P}/me/experience/${row.id}`).set(auth(t.emp.token))).status, 200);
  });

  it('validates education, family, languages and hobbies', async () => {
    assert.equal((await api.post(`${P}/me/education`).set(auth(t.emp.token)).send({ level: 'Graduate' })).status, 422);
    const ed = await api.post(`${P}/me/education`).set(auth(t.emp.token)).send({
      level: 'Graduate', certificate: 'B.Tech / B.E.', mode: 'Full Time', institute: 'COER', fromDate: '2015-07-01', toDate: '2019-06-01', passingYear: '2019', percentage: '78.5',
    });
    assert.equal(ed.status, 201, JSON.stringify(ed.body));
    assert.equal(ed.body.data.education[0].percentage, 78.5);
    assert.equal((await api.post(`${P}/me/education`).set(auth(t.emp.token)).send({ level: 'Graduate', certificate: 'x', mode: 'Full Time', institute: 'x', fromDate: '2015-07-01', toDate: '2019-06-01', percentage: '140' })).status, 422);
    const fam = await api.post(`${P}/me/family`).set(auth(t.emp.token)).send({ relationship: 'Father', name: 'Ram Karnwal', gender: 'Male', dateOfBirth: '1965-02-02', dependent: 'true', working: 'false' });
    assert.equal(fam.status, 201);
    assert.equal(fam.body.data.family[0].dependent, true);
    assert.equal((await api.post(`${P}/me/languages`).set(auth(t.emp.token)).send({ language: 'Bengali' })).status, 422, 'needs an ability');
    assert.equal((await api.post(`${P}/me/languages`).set(auth(t.emp.token)).send({ language: 'Bengali', speak: true })).status, 201);
    assert.equal((await api.post(`${P}/me/hobbies`).set(auth(t.emp.token)).send({})).status, 422);
    assert.equal((await api.post(`${P}/me/hobbies`).set(auth(t.emp.token)).send({ sportType: 'Cricket', hobby: 'Trekking' })).status, 201);
    assert.equal((await api.post(`${P}/me/family`).set(auth(t.emp.token)).attach('attachment', PDF, 'x.pdf').field('relationship', 'Mother').field('name', 'X').field('gender', 'Female').field('dateOfBirth', '1970-01-01')).status, 422, 'family takes no attachment');
  });

  it('HR can also maintain self-service sections; others cannot touch them', async () => {
    const r = await api.post(`${P}/${t.emp.user.id}/languages`).set(auth(t.hr.token)).send({ language: 'Sanskrit', read: true });
    assert.equal(r.status, 201);
    const row = r.body.data.languages.find((l) => l.language === 'Sanskrit');
    assert.equal((await api.delete(`${P}/${t.emp.user.id}/languages/${row.id}`).set(auth(t.peer.token))).status, 404);
    assert.equal((await api.delete(`${P}/${t.emp.user.id}/languages/${row.id}`).set(auth(t.hr.token))).status, 200);
  });
});
