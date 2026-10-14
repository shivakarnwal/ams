import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { api, auth, login, start, stop } from './setup.js';

const T = '/api/v1/tickets';
let t;
let meta;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const files = () => mongoose.connection.db.collection('ticketFiles.files');

function raise(token, fields = {}, attachments = []) {
  const it = meta.categories.find((c) => c.name === 'IT');
  const body = { category: it.id, subCategory: 'Hardware Issues', issueType: 'Laptop', subject: 'Laptop not charging', description: 'The charger light blinks but the battery stays at 3%.', ...fields };
  let r = api.post(T).set(auth(token));
  for (const [k, v] of Object.entries(body)) r = r.field(k, v);
  for (const [buf, name] of attachments) r = r.attach('attachments', buf, { filename: name });
  return r;
}
const get = (token, id) => api.get(`${T}/${id}`).set(auth(token));

let ticket; // raised by the employee

before(async () => {
  await start();
  t = {
    admin: await login('admin@example.com'),
    hr: await login('hr@example.com'),
    manager: await login('ashu.taneja@bharuwasolutions.com'),
    emp: await login('shiva.karnwal@bharuwasolutions.com'),
    peer: await login('ishika.sahu@bharuwasolutions.com'),
  };
  meta = (await api.get(`${T}/meta`).set(auth(t.emp.token))).body.data;
});
after(stop);

describe('tickets: reference data', () => {
  it('ships default categories, priorities and statuses', () => {
    const it = meta.categories.find((c) => c.name === 'IT');
    assert.equal(it.subCategories.length, 31);
    assert.ok(it.subCategories.some((s) => s.name === 'VPN Access'));
    assert.deepEqual(meta.categories.map((c) => c.name), ['IT', 'HR', 'Payroll', 'Attendance', 'Leave', 'Facilities', 'Other']);
    assert.deepEqual(meta.priorities.map((p) => p.name), ['Low', 'Normal', 'High', 'Critical']);
    assert.ok(meta.priorities.find((p) => p.name === 'Normal').isDefault);
    assert.equal(meta.statuses.length, 7);
    assert.equal(meta.assignees, undefined, 'employees do not get the assignee list');
  });
});

describe('tickets: raising', () => {
  it('validates the category chain', async () => {
    assert.equal((await raise(t.emp.token, { subCategory: 'Salary Slip' })).status, 422, 'sub category of another category');
    assert.equal((await raise(t.emp.token, { issueType: 'Coffee machine' })).status, 422);
    assert.equal((await raise(t.emp.token, { subject: 'Hi' })).status, 422);
    assert.equal((await raise(t.emp.token, { category: 'a'.repeat(24) })).status, 422);
  });

  it('rejects disallowed attachments without storing anything', async () => {
    const r = await raise(t.emp.token, {}, [[PNG, 'photo.png'], [Buffer.from('MZ evil'), 'run.exe']]);
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.attachments);
    assert.equal(await files().countDocuments(), 0);
  });

  it('raises a ticket with a number, the default priority and attachments', async () => {
    const r = await raise(t.emp.token, {}, [[PNG, 'charger.png']]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ticket = r.body.data;
    assert.match(ticket.ticketNo, /^TKT-\d{4}-00001$/);
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.priorityName, 'Normal');
    assert.equal(ticket.categoryName, 'IT');
    assert.equal(ticket.attachments.length, 1);
    assert.equal(ticket.attachments[0].fileId, undefined, 'storage ids must not leak');
    const second = await raise(t.peer.token, { subCategory: 'VPN Access', issueType: '', priority: meta.priorities.find((p) => p.name === 'High').id });
    assert.equal(second.status, 201);
    assert.match(second.body.data.ticketNo, /-00002$/);
  });
});

describe('tickets: visibility', () => {
  it('employees see only their own tickets', async () => {
    const mine = await api.get(T).set(auth(t.emp.token));
    assert.equal(mine.body.meta.total, 1);
    assert.equal((await api.get(`${T}?scope=all`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.get(`${T}?scope=all`).set(auth(t.manager.token))).status, 403);
    assert.equal((await get(t.peer.token, ticket.id)).status, 404);
    assert.equal((await get(t.manager.token, ticket.id)).status, 404);
  });

  it('HR sees all tickets and can filter and search', async () => {
    const all = await api.get(`${T}?scope=all`).set(auth(t.hr.token));
    assert.equal(all.body.meta.total, 2);
    const high = meta.priorities.find((p) => p.name === 'High').id;
    assert.equal((await api.get(`${T}?scope=all&priority=${high}`).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(`${T}?scope=all&q=Shiva`).set(auth(t.hr.token))).body.meta.total, 1, 'search by employee name');
    assert.equal((await api.get(`${T}?scope=all&q=${ticket.ticketNo}`).set(auth(t.hr.token))).body.meta.total, 1);
    assert.equal((await api.get(`${T}?scope=all&assignee=unassigned`).set(auth(t.hr.token))).body.meta.total, 2);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await api.get(`${T}?scope=all&from=2000-01-01&to=2000-01-02`).set(auth(t.hr.token))).body.meta.total, 0);
    assert.ok((await api.get(`${T}?scope=all&from=${today}`).set(auth(t.hr.token))).body.meta.total >= 1);
  });

  it('employee downloads their own attachment; others cannot', async () => {
    const att = ticket.attachments[0];
    const r = await api.get(`${T}/${ticket.id}/attachments/${att.id}`).set(auth(t.emp.token)).buffer(true).parse(binary);
    assert.equal(r.status, 200);
    assert.ok(r.body.equals(PNG));
    assert.equal((await api.get(`${T}/${ticket.id}/attachments/${att.id}`).set(auth(t.peer.token))).status, 404);
  });
});

describe('tickets: HR workflow', () => {
  it('only HR/Admin can assign, change status or priority', async () => {
    assert.equal((await api.patch(`${T}/${ticket.id}/assign`).set(auth(t.emp.token)).send({ assignee: t.hr.user.id })).status, 403);
    assert.equal((await api.patch(`${T}/${ticket.id}/status`).set(auth(t.emp.token)).send({ status: 'resolved' })).status, 403);
    assert.equal((await api.patch(`${T}/${ticket.id}/priority`).set(auth(t.manager.token)).send({ priority: meta.priorities[0].id })).status, 403);
  });

  it('assigning to HR moves an open ticket to Assigned; non-HR assignees are rejected', async () => {
    assert.equal((await api.patch(`${T}/${ticket.id}/assign`).set(auth(t.hr.token)).send({ assignee: t.emp.user.id })).status, 422);
    const r = await api.patch(`${T}/${ticket.id}/assign`).set(auth(t.hr.token)).send({ assignee: t.admin.user.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'assigned');
    assert.equal(r.body.data.assignedTo.name, 'System Admin');
  });

  it('internal notes are hidden from the employee', async () => {
    assert.equal((await api.post(`${T}/${ticket.id}/comments`).set(auth(t.emp.token)).field('body', 'psst').field('internal', 'true')).status, 403);
    const note = await api.post(`${T}/${ticket.id}/comments`).set(auth(t.admin.token)).field('body', 'Warranty expired, check stock').field('internal', 'true');
    assert.equal(note.status, 201);
    const reply = await api.post(`${T}/${ticket.id}/comments`).set(auth(t.admin.token)).field('body', 'Please share the laptop serial number.');
    assert.equal(reply.status, 201);
    const asEmp = (await get(t.emp.token, ticket.id)).body.data;
    assert.deepEqual(asEmp.comments.map((c) => c.body), ['Please share the laptop serial number.']);
    assert.ok(!asEmp.events.some((e) => e.type === 'internal_note'));
    const asHr = (await get(t.hr.token, ticket.id)).body.data;
    assert.equal(asHr.comments.length, 2);
    assert.ok(asHr.firstResponseAt);
  });

  it('an employee reply moves a Pending ticket back to In Progress', async () => {
    await api.patch(`${T}/${ticket.id}/status`).set(auth(t.hr.token)).send({ status: 'pending', note: 'Waiting for the serial number' });
    const r = await api.post(`${T}/${ticket.id}/comments`).set(auth(t.emp.token)).field('body', 'Serial: PF3XK21').attach('attachments', PNG, { filename: 'sticker.png' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.status, 'in_progress');
  });

  it('changes priority, resolves, closes and reopens with a full audit trail', async () => {
    const critical = meta.priorities.find((p) => p.name === 'Critical').id;
    assert.equal((await api.patch(`${T}/${ticket.id}/priority`).set(auth(t.hr.token)).send({ priority: critical })).body.data.priorityName, 'Critical');
    assert.equal((await api.patch(`${T}/${ticket.id}/status`).set(auth(t.hr.token)).send({ status: 'resolved', note: 'Charger replaced' })).status, 200);
    assert.equal((await api.patch(`${T}/${ticket.id}/status`).set(auth(t.hr.token)).send({ status: 'resolved' })).status, 409);
    assert.equal((await api.patch(`${T}/${ticket.id}/status`).set(auth(t.hr.token)).send({ status: 'closed' })).status, 200);

    const locked = await api.post(`${T}/${ticket.id}/comments`).set(auth(t.emp.token)).field('body', 'still broken');
    assert.equal(locked.status, 409, 'closed tickets do not accept employee replies');
    assert.equal((await api.patch(`${T}/${ticket.id}/cancel`).set(auth(t.emp.token)).send({})).status, 409);

    const reopened = await api.patch(`${T}/${ticket.id}/status`).set(auth(t.hr.token)).send({ status: 'in_progress', note: 'Reopened at employee request' });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.data.closedAt, undefined);

    const { events } = (await get(t.hr.token, ticket.id)).body.data;
    const types = events.map((e) => e.type);
    for (const type of ['created', 'assigned', 'status_changed', 'internal_note', 'comment', 'priority_changed', 'reopened']) assert.ok(types.includes(type), `missing ${type}`);
  });

  it('the owner can cancel an active ticket; others cannot', async () => {
    assert.equal((await api.patch(`${T}/${ticket.id}/cancel`).set(auth(t.hr.token)).send({})).status, 403);
    const r = await api.patch(`${T}/${ticket.id}/cancel`).set(auth(t.emp.token)).send({ reason: 'Fixed itself' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'cancelled');
  });

  it('reports stats for "me" and "all"', async () => {
    const me = (await api.get(`${T}/stats`).set(auth(t.emp.token))).body.data;
    assert.equal(me.total, 1);
    assert.equal(me.byStatus.cancelled, 1);
    assert.equal((await api.get(`${T}/stats?scope=all`).set(auth(t.emp.token))).status, 403);
    const all = (await api.get(`${T}/stats?scope=all`).set(auth(t.hr.token))).body.data;
    assert.equal(all.total, 2);
    assert.equal(all.unassigned, 1);
  });
});

describe('tickets: settings (categories & priorities)', () => {
  it('only HR/Admin can manage settings', async () => {
    assert.equal((await api.get(`${T}/settings/categories`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.post(`${T}/settings/priorities`).set(auth(t.emp.token)).send({ name: 'Urgent', level: 5 })).status, 403);
  });

  it('creates, edits and protects categories that are in use', async () => {
    const c = await api.post(`${T}/settings/categories`).set(auth(t.hr.token)).send({ name: 'Security', subCategories: [{ name: 'Badge lost', issueTypes: ['Temporary badge'] }] });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal((await api.post(`${T}/settings/categories`).set(auth(t.hr.token)).send({ name: 'security', subCategories: [{ name: 'x' }] })).status, 409);
    assert.equal((await api.post(`${T}/settings/categories`).set(auth(t.hr.token)).send({ name: 'Dupes', subCategories: [{ name: 'A' }, { name: 'a' }] })).status, 422);
    const it = meta.categories.find((x) => x.name === 'IT');
    assert.equal((await api.delete(`${T}/settings/categories/${it.id}`).set(auth(t.hr.token))).status, 409);
    assert.equal((await api.patch(`${T}/settings/categories/${c.body.data.id}`).set(auth(t.hr.token)).send({ active: false })).status, 200);
    const m = (await api.get(`${T}/meta`).set(auth(t.emp.token))).body.data;
    assert.ok(!m.categories.some((x) => x.name === 'Security'), 'inactive categories are hidden from new tickets');
    assert.equal((await api.delete(`${T}/settings/categories/${c.body.data.id}`).set(auth(t.admin.token))).status, 200);
  });

  it('keeps exactly one default priority', async () => {
    const r = await api.post(`${T}/settings/priorities`).set(auth(t.hr.token)).send({ name: 'Urgent', level: 5, color: 'purple', isDefault: true });
    assert.equal(r.status, 201);
    const list = (await api.get(`${T}/settings/priorities`).set(auth(t.hr.token))).body.data;
    assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.name), ['Urgent']);
    assert.equal((await api.delete(`${T}/settings/priorities/${r.body.data.id}`).set(auth(t.hr.token))).status, 409, 'default cannot be deleted');
    const normal = list.find((p) => p.name === 'Normal');
    assert.equal((await api.patch(`${T}/settings/priorities/${normal.id}`).set(auth(t.hr.token)).send({ isDefault: true })).status, 200);
    assert.equal((await api.delete(`${T}/settings/priorities/${r.body.data.id}`).set(auth(t.hr.token))).status, 200);
    assert.equal((await api.delete(`${T}/settings/priorities/${normal.id}`).set(auth(t.hr.token))).status, 409);
  });
});
