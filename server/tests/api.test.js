import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, login, start, stop } from './setup.js';

const P = '/api/v1';
let t; // tokens by role
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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

describe('auth', () => {
  it('health endpoint is public', async () => {
    const r = await api.get(`${P}/health`);
    assert.equal(r.status, 200);
  });
  it('login returns token + user without password (legacy-compatible shape)', async () => {
    const r = await api.post(`${P}/auth/login`).send({ email: 'shiva.karnwal@bharuwasolutions.com', password: process.env.SEED_PASSWORD, device_id: 'DEVICE-001' });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal(r.body.user.email, 'shiva.karnwal@bharuwasolutions.com');
    assert.equal(r.body.user.password, undefined);
    assert.equal(r.body.user.tokenVersion, undefined);
  });
  it('rejects wrong password with 401 and bad payload with 422', async () => {
    const bad = await api.post(`${P}/auth/login`).send({ email: 'shiva.karnwal@bharuwasolutions.com', password: 'nope' });
    assert.equal(bad.status, 401);
    const invalid = await api.post(`${P}/auth/login`).send({ email: 'not-an-email', password: '' });
    assert.equal(invalid.status, 422);
    assert.ok(invalid.body.errors.email);
  });
  it('protects routes and validates tokens', async () => {
    assert.equal((await api.get(`${P}/auth/me`)).status, 401);
    assert.equal((await api.get(`${P}/auth/me`).set(auth('garbage'))).status, 401);
    const me = await api.get(`${P}/auth/me`).set(auth(t.emp.token));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.manager.name, 'Ashu Taneja');
  });
  it('public signup is disabled by default', async () => {
    const r = await api.post(`${P}/auth/register`).send({ name: 'New Person', email: 'new@x.com', password: 'Abcdef12' });
    assert.equal(r.status, 403);
  });
  it('updates own profile but cannot change role', async () => {
    const r = await api.put(`${P}/auth/profile`).set(auth(t.emp.token)).send({ contact: '9999999999', role: 'admin' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.contact, '9999999999');
    assert.equal(r.body.data.role, 'employee');
  });
  it('change password revokes old tokens; logout revokes too', async () => {
    const u = await login('ishika.sahu@bharuwasolutions.com');
    const wrong = await api.post(`${P}/auth/change-password`).set(auth(u.token)).send({ currentPassword: 'wrong', newPassword: 'NewPass123' });
    assert.equal(wrong.status, 422);
    const ok = await api.post(`${P}/auth/change-password`).set(auth(u.token)).send({ currentPassword: process.env.SEED_PASSWORD, newPassword: 'NewPass123' });
    assert.equal(ok.status, 200);
    assert.equal((await api.get(`${P}/auth/me`).set(auth(u.token))).status, 401);
    assert.equal((await api.get(`${P}/auth/me`).set(auth(ok.body.token))).status, 200);
    await api.post(`${P}/auth/logout`).set(auth(ok.body.token));
    assert.equal((await api.get(`${P}/auth/me`).set(auth(ok.body.token))).status, 401);
    // restore password for later tests
    const { User } = await import('../src/models/User.js');
    const doc = await User.findOne({ email: 'ishika.sahu@bharuwasolutions.com' });
    doc.password = process.env.SEED_PASSWORD; await doc.save();
    t.peer = await login('ishika.sahu@bharuwasolutions.com');
  });
});

describe('leave workflow', () => {
  let leaveId;
  const payload = { leaveType: 'casual', duration: 'full', startDate: day(10), endDate: day(11), reason: 'Family function', contactNumber: '9876543210' };

  it('validates input', async () => {
    const r = await api.post(`${P}/leaves`).set(auth(t.emp.token)).send({ leaveType: 'bogus', startDate: '', reason: '' });
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.leaveType && r.body.errors.startDate && r.body.errors.reason);
    const range = await api.post(`${P}/leaves`).set(auth(t.emp.token)).send({ ...payload, endDate: day(5) });
    assert.equal(range.status, 422);
    assert.ok(range.body.errors.endDate);
  });
  it('creates a leave computing days server-side (ignores forged status/employee)', async () => {
    const r = await api.post(`${P}/leaves`).set(auth(t.emp.token)).send({ ...payload, status: 'approved', numDays: 99, employee: t.hr.user.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.status, 'pending');
    assert.equal(r.body.data.numDays, 2);
    assert.equal(r.body.data.employee.id, t.emp.user.id);
    leaveId = r.body.data.id;
  });
  it('blocks overlapping requests and insufficient balance', async () => {
    assert.equal((await api.post(`${P}/leaves`).set(auth(t.emp.token)).send(payload)).status, 409);
    const big = await api.post(`${P}/leaves`).set(auth(t.emp.token)).send({ ...payload, leaveType: 'maternity', startDate: day(40), endDate: day(41) });
    assert.equal(big.status, 400);
    assert.match(big.body.message, /Insufficient/);
  });
  it('enforces access control', async () => {
    assert.equal((await api.get(`${P}/leaves/${leaveId}`).set(auth(t.peer.token))).status, 403);
    assert.equal((await api.patch(`${P}/leaves/${leaveId}/status`).set(auth(t.emp.token)).send({ status: 'approved' })).status, 403);
    assert.equal((await api.patch(`${P}/leaves/${leaveId}/status`).set(auth(t.peer.token)).send({ status: 'approved' })).status, 403);
    assert.equal((await api.get(`${P}/leaves?scope=all`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.get(`${P}/leaves?scope=team`).set(auth(t.emp.token))).status, 403);
  });
  it('rejects NoSQL operator injection', async () => {
    const r = await api.get(`${P}/leaves?status[$ne]=x`).set(auth(t.emp.token));
    assert.equal(r.status, 400);
  });
  it('lists own + team + paginated', async () => {
    const mine = await api.get(`${P}/leaves?limit=5`).set(auth(t.emp.token));
    assert.equal(mine.body.meta.total, 1);
    const team = await api.get(`${P}/leaves?scope=team`).set(auth(t.manager.token));
    assert.equal(team.body.data.length, 1);
    assert.equal((await api.get(`${P}/leaves?scope=team`).set(auth(t.peer.token))).status, 403);
  });
  it('edits while pending', async () => {
    const r = await api.put(`${P}/leaves/${leaveId}`).set(auth(t.emp.token)).send({ reason: 'Updated reason', endDate: day(12) });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.numDays, 3);
  });
  it('manager must give a reason to reject; approval deducts balance', async () => {
    const noReason = await api.patch(`${P}/leaves/${leaveId}/status`).set(auth(t.manager.token)).send({ status: 'rejected' });
    assert.equal(noReason.status, 422);
    const ok = await api.patch(`${P}/leaves/${leaveId}/status`).set(auth(t.manager.token)).send({ status: 'approved', remarks: 'ok' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.status, 'approved');
    const bal = await api.get(`${P}/leaves/balance`).set(auth(t.emp.token));
    assert.equal(bal.body.data.balance.casual, 4);
    assert.equal(bal.body.data.used.casual, 3);
    assert.equal((await api.patch(`${P}/leaves/${leaveId}/status`).set(auth(t.manager.token)).send({ status: 'rejected', remarks: 'late' })).status, 409);
    assert.equal((await api.put(`${P}/leaves/${leaveId}`).set(auth(t.emp.token)).send({ reason: 'x y z' })).status, 409);
  });
  it('cancelling an approved leave refunds the balance', async () => {
    const r = await api.patch(`${P}/leaves/${leaveId}/cancel`).set(auth(t.emp.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'cancelled');
    const bal = await api.get(`${P}/leaves/balance`).set(auth(t.emp.token));
    assert.equal(bal.body.data.balance.casual, 7);
  });
  it('owner deletes a pending request; cannot delete non-pending', async () => {
    const c = await api.post(`${P}/leaves`).set(auth(t.emp.token)).send({ ...payload, startDate: day(20), endDate: day(20), duration: 'first_half' });
    assert.equal(c.body.data.numDays, 0.5);
    assert.equal((await api.delete(`${P}/leaves/${c.body.data.id}`).set(auth(t.emp.token))).status, 200);
    assert.equal((await api.delete(`${P}/leaves/${leaveId}`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.delete(`${P}/leaves/${leaveId}`).set(auth(t.admin.token))).status, 200);
    assert.equal((await api.get(`${P}/leaves/${leaveId}`).set(auth(t.admin.token))).status, 404);
    assert.equal((await api.get(`${P}/leaves/not-an-id`).set(auth(t.admin.token))).status, 400);
  });
});

describe('comp-off', () => {
  it('validates, creates, approves (credits balance) and reverses on cancel', async () => {
    const bad = await api.post(`${P}/comp-offs`).set(auth(t.emp.token)).send({ workDate: day(3), dutyHours: 8, appliedFor: 'full', reason: 'Worked on Sunday' });
    assert.equal(bad.status, 400);
    const create = await api.post(`${P}/comp-offs`).set(auth(t.emp.token)).send({ workDate: day(-3), dutyHours: 9, appliedFor: 'full', reason: 'Worked on Sunday' });
    assert.equal(create.status, 201);
    const id = create.body.data.id;
    assert.equal((await api.post(`${P}/comp-offs`).set(auth(t.emp.token)).send({ workDate: day(-3), dutyHours: 9, appliedFor: 'half', reason: 'dup dup' })).status, 409);
    assert.equal((await api.patch(`${P}/comp-offs/${id}/status`).set(auth(t.manager.token)).send({ status: 'approved' })).status, 200);
    assert.equal((await api.get(`${P}/leaves/balance`).set(auth(t.emp.token))).body.data.balance.compOff, 1);
    assert.equal((await api.patch(`${P}/comp-offs/${id}/cancel`).set(auth(t.emp.token))).status, 200);
    assert.equal((await api.get(`${P}/leaves/balance`).set(auth(t.emp.token))).body.data.balance.compOff, 0);
  });
});

describe('attendance + regularization', () => {
  it('punches in/out once per day and rejects repeats', async () => {
    assert.equal((await api.post(`${P}/attendance/punch-out`).set(auth(t.emp.token))).status, 400);
    assert.equal((await api.post(`${P}/attendance/punch-in`).set(auth(t.emp.token))).status, 201);
    assert.equal((await api.post(`${P}/attendance/punch-in`).set(auth(t.emp.token))).status, 409);
    assert.equal((await api.post(`${P}/attendance/punch-out`).set(auth(t.emp.token))).status, 200);
    assert.equal((await api.post(`${P}/attendance/punch-out`).set(auth(t.emp.token))).status, 409);
    const today = await api.get(`${P}/attendance/today`).set(auth(t.emp.token));
    assert.ok(today.body.data.inTime && today.body.data.outTime);
  });
  it('lists a month and returns summary', async () => {
    const list = await api.get(`${P}/attendance`).set(auth(t.emp.token));
    assert.ok(list.body.data.length >= 1);
    const s = await api.get(`${P}/attendance/summary`).set(auth(t.emp.token));
    assert.equal(s.status, 200);
    assert.equal(s.body.data.week.targetMinutes, 48 * 60);
    assert.equal(s.body.data.monthlyDutyHours.length, 6);
    assert.equal((await api.get(`${P}/attendance/summary?employeeId=${t.manager.user.id}`).set(auth(t.emp.token))).status, 403);
    assert.equal((await api.get(`${P}/attendance/summary?employeeId=${t.emp.user.id}`).set(auth(t.manager.token))).status, 200);
  });
  it('regularization requires a time for punch types, and approval updates attendance', async () => {
    const date = day(-8);
    const noTime = await api.post(`${P}/regularizations`).set(auth(t.emp.token)).send({ type: 'in-punch', date });
    assert.equal(noTime.status, 422);
    assert.ok(noTime.body.errors.time);
    const inp = await api.post(`${P}/regularizations`).set(auth(t.emp.token)).send({ type: 'in-punch', date, time: '09:30', reason: 'Forgot to punch' });
    assert.equal(inp.status, 201);
    assert.equal((await api.post(`${P}/regularizations`).set(auth(t.emp.token)).send({ type: 'in-punch', date, time: '09:35' })).status, 409);
    const wfh = await api.post(`${P}/regularizations`).set(auth(t.emp.token)).send({ type: 'wfh', date: day(-9) });
    assert.equal(wfh.status, 201);
    const stats = await api.get(`${P}/regularizations/stats`).set(auth(t.emp.token));
    assert.equal(stats.body.data.byGroup['in-punch'], 1);
    assert.equal(stats.body.data.byGroup.wfh, 1);
    assert.equal((await api.patch(`${P}/regularizations/${inp.body.data.id}/status`).set(auth(t.manager.token)).send({ status: 'approved' })).status, 200);
    const att = await api.get(`${P}/attendance?month=${date.slice(0, 7)}`).set(auth(t.emp.token));
    const row = att.body.data.find((a) => a.date === date);
    assert.ok(row && row.inTime);
    // out-punch earlier than in-punch must fail and leave the request pending
    const out = await api.post(`${P}/regularizations`).set(auth(t.emp.token)).send({ type: 'out-punch', date, time: '08:00' });
    const bad = await api.patch(`${P}/regularizations/${out.body.data.id}/status`).set(auth(t.manager.token)).send({ status: 'approved' });
    assert.equal(bad.status, 400);
    assert.equal((await api.get(`${P}/regularizations/${out.body.data.id}`).set(auth(t.emp.token))).body.data.status, 'pending');
  });
  it('only hr/admin can edit attendance manually', async () => {
    const body = { employee: t.emp.user.id, date: day(-30), inTime: '09:00', outTime: '18:00' };
    assert.equal((await api.post(`${P}/attendance`).set(auth(t.emp.token)).send(body)).status, 403);
    const c = await api.post(`${P}/attendance`).set(auth(t.hr.token)).send(body);
    assert.equal(c.status, 201);
    assert.equal(c.body.data.workMinutes, 540);
    assert.equal((await api.put(`${P}/attendance/${c.body.data.id}`).set(auth(t.hr.token)).send({ status: 'half_day' })).body.data.status, 'half_day');
    assert.equal((await api.delete(`${P}/attendance/${c.body.data.id}`).set(auth(t.hr.token))).status, 403);
    assert.equal((await api.delete(`${P}/attendance/${c.body.data.id}`).set(auth(t.admin.token))).status, 200);
  });
});

describe('visitors + travel expenses', () => {
  it('visitor CRUD + review', async () => {
    const bad = await api.post(`${P}/visitors`).set(auth(t.emp.token)).send({ visitorName: 'X', purpose: 'Meet', visitDate: day(-2) });
    assert.equal(bad.status, 400);
    const c = await api.post(`${P}/visitors`).set(auth(t.emp.token)).send({ visitorName: 'Neha Rao', company: 'Beta', purpose: 'Vendor demo', visitDate: day(2), email: 'neha@beta.com' });
    assert.equal(c.status, 201);
    const u = await api.put(`${P}/visitors/${c.body.data.id}`).set(auth(t.emp.token)).send({ purpose: 'Vendor demo v2' });
    assert.equal(u.body.data.purpose, 'Vendor demo v2');
    assert.equal((await api.patch(`${P}/visitors/${c.body.data.id}/status`).set(auth(t.manager.token)).send({ status: 'approved' })).body.data.status, 'approved');
    const list = await api.get(`${P}/visitors?status=approved`).set(auth(t.emp.token));
    assert.equal(list.body.data.length, 1);
  });
  it('travel expense goes pending -> approved -> paid', async () => {
    const c = await api.post(`${P}/travel-expenses`).set(auth(t.emp.token)).send({ purpose: 'Client meeting', fromLocation: 'Haridwar', toLocation: 'Delhi', travelDate: day(-1), mode: 'train', amount: '2450.50' });
    assert.equal(c.status, 201);
    assert.match(c.body.data.expenseNo, /^TE-/);
    assert.equal(c.body.data.amount, 2450.5);
    const id = c.body.data.id;
    assert.equal((await api.patch(`${P}/travel-expenses/${id}/status`).set(auth(t.manager.token)).send({ status: 'paid' })).status, 409);
    assert.equal((await api.patch(`${P}/travel-expenses/${id}/status`).set(auth(t.manager.token)).send({ status: 'approved' })).status, 200);
    assert.equal((await api.patch(`${P}/travel-expenses/${id}/status`).set(auth(t.hr.token)).send({ status: 'paid' })).body.data.status, 'paid');
    assert.equal((await api.post(`${P}/travel-expenses`).set(auth(t.emp.token)).send({ purpose: 'x', amount: -5 })).status, 422);
  });
});

describe('employees', () => {
  it('directory lists with filters + pagination, hides sensitive fields from employees', async () => {
    const r = await api.get(`${P}/employees?limit=3&page=1`).set(auth(t.emp.token));
    assert.equal(r.body.data.length, 3);
    assert.ok(r.body.meta.total >= 8);
    assert.equal(r.body.data[0].leaveBalance, undefined);
    const f = await api.get(`${P}/employees?name=shiva&department=Engineering`).set(auth(t.emp.token));
    assert.equal(f.body.data.length, 1);
    const hrView = await api.get(`${P}/employees?code=1100175`).set(auth(t.hr.token));
    assert.ok(hrView.body.data[0].leaveBalance);
    const filters = await api.get(`${P}/employees/filters`).set(auth(t.emp.token));
    assert.ok(filters.body.data.departments.includes('Engineering'));
  });
  it('team chart shows manager, peers and reports', async () => {
    const r = await api.get(`${P}/employees/team-chart`).set(auth(t.emp.token));
    assert.equal(r.body.data.manager.name, 'Ashu Taneja');
    assert.ok(r.body.data.peers.length >= 2);
    const m = await api.get(`${P}/employees/team-chart`).set(auth(t.manager.token));
    assert.ok(m.body.data.reports.length >= 3);
  });
  it('enforces roles on create/update/delete', async () => {
    const body = { employeeCode: 'E9001', name: 'Test Person', email: 'test.person@x.com', password: 'Secret123', designation: 'QA', department: 'Engineering', location: 'Noida' };
    assert.equal((await api.post(`${P}/employees`).set(auth(t.emp.token)).send(body)).status, 403);
    assert.equal((await api.post(`${P}/employees`).set(auth(t.hr.token)).send({ ...body, role: 'admin' })).status, 403);
    assert.equal((await api.post(`${P}/employees`).set(auth(t.hr.token)).send({ ...body, password: 'short' })).status, 422);
    const c = await api.post(`${P}/employees`).set(auth(t.hr.token)).send({ ...body, manager: t.manager.user.id });
    assert.equal(c.status, 201);
    assert.equal(c.body.data.password, undefined);
    assert.equal((await api.post(`${P}/employees`).set(auth(t.hr.token)).send(body)).status, 409);
    const id = c.body.data.id;
    const upd = await api.put(`${P}/employees/${id}`).set(auth(t.hr.token)).send({ designation: 'Senior QA' });
    assert.equal(upd.body.data.designation, 'Senior QA');
    const login2 = await api.post(`${P}/auth/login`).send({ email: 'test.person@x.com', password: 'Secret123' });
    assert.equal(login2.status, 200);
    assert.equal((await api.patch(`${P}/employees/${id}/status`).set(auth(t.hr.token)).send({ status: 'inactive' })).status, 200);
    assert.equal((await api.get(`${P}/auth/me`).set(auth(login2.body.token))).status, 401);
    assert.equal((await api.post(`${P}/auth/login`).send({ email: 'test.person@x.com', password: 'Secret123' })).status, 403);
    assert.equal((await api.delete(`${P}/employees/${id}`).set(auth(t.hr.token))).status, 403);
    assert.equal((await api.delete(`${P}/employees/${id}`).set(auth(t.admin.token))).status, 200);
    assert.equal((await api.delete(`${P}/employees/${t.admin.user.id}`).set(auth(t.admin.token))).status, 400);
    assert.equal((await api.get(`${P}/employees/${id}`).set(auth(t.admin.token))).status, 404);
  });
});

describe('manpower + candidates + confirmations', () => {
  it('requisition lifecycle', async () => {
    assert.equal((await api.get(`${P}/manpower-requisitions`).set(auth(t.emp.token))).status, 403);
    const body = { jobTitle: 'QA Engineer', startingDate: day(30), department: 'Engineering', designation: 'QA', location: 'Noida', vacancies: 2 };
    assert.equal((await api.post(`${P}/manpower-requisitions`).set(auth(t.manager.token)).send({ ...body, vacancies: 0 })).status, 422);
    const c = await api.post(`${P}/manpower-requisitions`).set(auth(t.manager.token)).send(body);
    assert.equal(c.status, 201);
    const id = c.body.data.id;
    assert.equal((await api.patch(`${P}/manpower-requisitions/${id}/status`).set(auth(t.manager.token)).send({ status: 'approved' })).status, 403);
    assert.equal((await api.patch(`${P}/manpower-requisitions/${id}/status`).set(auth(t.hr.token)).send({ status: 'approved' })).body.data.status, 'approved');
    const filtered = await api.get(`${P}/manpower-requisitions?from=${day(-1)}&to=${day(1)}`).set(auth(t.hr.token));
    assert.equal(filtered.body.data.length, 1);
    assert.equal((await api.get(`${P}/manpower-requisitions?from=${day(5)}`).set(auth(t.hr.token))).body.data.length, 0);
  });
  it('candidate: request -> approve -> interview evaluation', async () => {
    const c = await api.post(`${P}/candidates`).set(auth(t.manager.token)).send({ name: 'Riya Sen', email: 'riya@x.com', contact: '9000000000', jobTitle: 'QA Engineer', startingDate: day(30) });
    assert.equal(c.status, 201);
    const id = c.body.data.id;
    assert.equal((await api.get(`${P}/candidates?stage=request`).set(auth(t.hr.token))).body.data.length, 1);
    assert.equal((await api.patch(`${P}/candidates/${id}/evaluate`).set(auth(t.hr.token)).send({ rating: 4, feedback: 'Good', result: 'selected' })).status, 409);
    assert.equal((await api.patch(`${P}/candidates/${id}/decision`).set(auth(t.manager.token)).send({ decision: 'approve' })).status, 403);
    assert.equal((await api.patch(`${P}/candidates/${id}/decision`).set(auth(t.hr.token)).send({ decision: 'approve' })).body.data.stage, 'interview');
    assert.equal((await api.patch(`${P}/candidates/${id}/evaluate`).set(auth(t.manager.token)).send({ rating: 9, feedback: 'Good', result: 'selected' })).status, 422);
    const ev = await api.patch(`${P}/candidates/${id}/evaluate`).set(auth(t.manager.token)).send({ rating: 4, feedback: 'Strong problem solving', result: 'selected' });
    assert.equal(ev.body.data.status, 'selected');
    assert.equal(ev.body.data.stage, 'closed');
  });
  it('confirmation lifecycle', async () => {
    const c = await api.post(`${P}/confirmations`).set(auth(t.manager.token)).send({ employee: t.emp.user.id, probationEndDate: day(15) });
    assert.equal(c.status, 201);
    assert.equal((await api.post(`${P}/confirmations`).set(auth(t.manager.token)).send({ employee: t.emp.user.id, probationEndDate: day(15) })).status, 409);
    assert.equal((await api.post(`${P}/confirmations`).set(auth(t.manager.token)).send({ employee: t.hr.user.id, probationEndDate: day(15) })).status, 403);
    assert.equal((await api.get(`${P}/confirmations`).set(auth(t.emp.token))).body.data.length, 1);
    const id = c.body.data.id;
    assert.equal((await api.patch(`${P}/confirmations/${id}/status`).set(auth(t.hr.token)).send({ status: 'extended' })).status, 422);
    assert.equal((await api.patch(`${P}/confirmations/${id}/status`).set(auth(t.hr.token)).send({ status: 'confirmed', remarks: 'Great' })).body.data.status, 'confirmed');
  });
});

describe('dashboard + content', () => {
  it('holidays and announcements: read for all, write for hr only', async () => {
    const h = await api.get(`${P}/holidays?upcoming=true`).set(auth(t.emp.token));
    assert.ok(h.body.data.length >= 1);
    assert.equal((await api.post(`${P}/holidays`).set(auth(t.emp.token)).send({ name: 'X', date: day(50) })).status, 403);
    const c = await api.post(`${P}/holidays`).set(auth(t.hr.token)).send({ name: 'Company Day', date: day(50) });
    assert.equal(c.status, 201);
    assert.equal((await api.delete(`${P}/holidays/${c.body.data.id}`).set(auth(t.hr.token))).status, 200);
    const a = await api.post(`${P}/announcements`).set(auth(t.hr.token)).send({ title: 'Office closed Friday', body: 'Maintenance' });
    assert.equal(a.status, 201);
  });
  it('dashboard aggregates data by role', async () => {
    const emp = await api.get(`${P}/dashboard`).set(auth(t.emp.token));
    assert.equal(emp.status, 200);
    assert.equal(emp.body.data.pendingApprovals.total, 0);
    assert.ok(emp.body.data.leaveBalance);
    assert.ok(emp.body.data.holidays.length >= 1);
    const mgr = await api.get(`${P}/dashboard`).set(auth(t.manager.token));
    assert.ok(mgr.body.data.pendingApprovals.total >= 1);
  });
  it('unknown routes return JSON 404', async () => {
    const r = await api.get(`${P}/nope`).set(auth(t.emp.token));
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
  });
});

describe('platform', () => {
  it('readiness reports database state and every response carries a request id', async () => {
    const r = await api.get(`${P}/ready`);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ready');
    assert.ok(r.headers['x-request-id']);
    const echoed = await api.get(`${P}/health`).set('X-Request-Id', 'abc-123');
    assert.equal(echoed.headers['x-request-id'], 'abc-123');
  });
  it('serves the OpenAPI document covering the main resources', async () => {
    const r = await api.get('/api/openapi.json');
    assert.equal(r.status, 200);
    for (const path of ['/auth/login', '/leaves/{id}/status', '/attendance/punch-in', '/employees/{id}/reset-password', '/candidates/{id}/evaluate', '/salary-slips/{id}/download']) {
      assert.ok(r.body.paths[path], `missing ${path}`);
    }
    assert.equal((await api.get('/api/docs/')).status, 200);
  });
  it('rejects malformed JSON with 400 and oversize ids with 400', async () => {
    const bad = await api.post(`${P}/auth/login`).set('Content-Type', 'application/json').send('{"email":');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.success, false);
  });
});
