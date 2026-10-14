import { User } from '../models/User.js';
import { Leave } from '../models/Leave.js';
import { CompOff } from '../models/CompOff.js';
import { Attendance } from '../models/Attendance.js';
import { Regularization } from '../models/Regularization.js';
import { Visitor } from '../models/Visitor.js';
import { TravelExpense } from '../models/TravelExpense.js';
import { Confirmation } from '../models/Confirmation.js';
import { SalarySlip } from '../models/SalarySlip.js';
import { AppraisalLetter } from '../models/AppraisalLetter.js';
import { Form16 } from '../models/Form16.js';
import { EmployeeProfile, ProfileAudit } from '../models/EmployeeProfile.js';
import { createFileStore } from '../utils/gridfs.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok } from '../utils/helpers.js';
import { isPrivileged } from '../utils/access.js';

const PUBLIC_FIELDS = 'employeeCode name email designation department location branch contact avatar manager status role dateOfJoining';
const MANAGER_POP = { path: 'manager', select: 'name employeeCode designation' };
const str = (v) => (typeof v === 'string' ? v.trim() : '');

async function load(id) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid id');
  const u = await User.findById(id);
  if (!u) throw ApiError.notFound('Employee not found');
  return u;
}

function assertCanAssignRole(actor, role, target) {
  if (actor.role === 'admin') return;
  if (['admin', 'hr'].includes(role) || (target && ['admin', 'hr'].includes(target.role))) {
    throw ApiError.forbidden('Only an admin can create or modify HR/admin accounts');
  }
}

async function assertManager(managerId, selfId) {
  if (!managerId) return;
  if (selfId && String(managerId) === String(selfId)) throw ApiError.badRequest('An employee cannot report to themselves');
  if (!(await User.exists({ _id: managerId }))) throw ApiError.badRequest('Selected manager does not exist');
}

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 10 });
  const q = req.query;
  const filter = {};
  if (str(q.code)) filter.employeeCode = new RegExp(escapeRegex(str(q.code)), 'i');
  if (str(q.name)) filter.name = new RegExp(escapeRegex(str(q.name)), 'i');
  if (str(q.q)) {
    const rx = new RegExp(escapeRegex(str(q.q)), 'i');
    filter.$or = [{ name: rx }, { employeeCode: rx }, { email: rx }];
  }
  for (const f of ['department', 'designation', 'location', 'role']) if (str(q[f])) filter[f] = str(q[f]);
  const priv = isPrivileged(req.user);
  if (priv && ['active', 'inactive'].includes(q.status)) filter.status = q.status;
  else if (!priv) filter.status = 'active';

  const query = User.find(filter).sort({ name: 1 }).skip(skip).limit(limit).populate(MANAGER_POP);
  if (!priv) query.select(PUBLIC_FIELDS);
  const [items, total] = await Promise.all([query, User.countDocuments(filter)]);
  ok(res, items, { meta: buildMeta(page, limit, total) });
});

export const filters = asyncHandler(async (_req, res) => {
  const [departments, designations, locations] = await Promise.all(
    ['department', 'designation', 'location'].map((f) => User.distinct(f, { status: 'active', [f]: { $ne: '' } })),
  );
  ok(res, { departments: departments.sort(), designations: designations.sort(), locations: locations.sort() });
});

export const getOne = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  const isSelf = String(user._id) === String(req.user._id);
  const full = isPrivileged(req.user) || isSelf;
  const doc = await User.findById(user._id).select(full ? '' : PUBLIC_FIELDS).populate(MANAGER_POP);
  ok(res, doc);
});

export const teamChart = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).populate(MANAGER_POP);
  const fields = 'employeeCode name designation department email avatar';
  const [reports, peers] = await Promise.all([
    User.find({ manager: me._id, status: 'active' }).select(fields).sort({ name: 1 }),
    me.manager ? User.find({ manager: me.manager._id, _id: { $ne: me._id }, status: 'active' }).select(fields).sort({ name: 1 }) : [],
  ]);
  ok(res, { self: me, manager: me.manager || null, reports, peers });
});

export const create = asyncHandler(async (req, res) => {
  assertCanAssignRole(req.user, req.body.role);
  await assertManager(req.body.manager);
  const user = await User.create(req.body);
  ok(res, await User.findById(user._id).populate(MANAGER_POP), { message: 'Employee created successfully' }, 201);
});

export const update = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  assertCanAssignRole(req.user, req.body.role ?? user.role, user);
  if (req.body.manager !== undefined) await assertManager(req.body.manager, user._id);
  if (String(user._id) === String(req.user._id) && req.body.status === 'inactive') throw ApiError.badRequest('You cannot deactivate your own account');
  user.set(req.body);
  await user.save();
  ok(res, await User.findById(user._id).populate(MANAGER_POP), { message: 'Employee updated successfully' });
});

export const setStatus = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  assertCanAssignRole(req.user, user.role, user);
  if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot change your own status');
  user.status = req.body.status;
  if (user.status === 'inactive') user.tokenVersion += 1;
  await user.save();
  ok(res, user, { message: `Employee ${user.status === 'active' ? 'activated' : 'deactivated'}` });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  assertCanAssignRole(req.user, user.role, user);
  user.password = req.body.newPassword;
  user.tokenVersion += 1;
  await user.save();
  ok(res, null, { message: 'Password reset successfully' });
});

export const updateBalance = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  for (const [k, v] of Object.entries(req.body)) user.leaveBalance[k] = v;
  await user.save();
  ok(res, user.leaveBalance, { message: 'Leave balance updated' });
});

export const remove = asyncHandler(async (req, res) => {
  const user = await load(req.params.id);
  if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot delete your own account');
  await Promise.all([
    User.updateMany({ manager: user._id }, { manager: null }),
    ...[Leave, CompOff, Attendance, Regularization, Visitor, TravelExpense, Confirmation, SalarySlip, AppraisalLetter, Form16].map((M) => M.deleteMany({ employee: user._id })),
  ]);
  // the extended profile (incl. encrypted bank/ID data and uploaded documents) goes with the account
  const profile = await EmployeeProfile.findOne({ user: user._id });
  if (profile) {
    const fileIds = [...profile.documents.map((d) => d.file?.fileId), ...profile.experience.map((e) => e.attachment?.fileId), ...profile.education.map((e) => e.attachment?.fileId)];
    await createFileStore('profileFiles').remove(fileIds);
    await profile.deleteOne();
  }
  await ProfileAudit.deleteMany({ user: user._id });
  await Promise.all([
    EmployeeProfile.updateMany({ 'employment.hod': user._id }, { 'employment.hod': null }),
    EmployeeProfile.updateMany({ 'employment.adminManager': user._id }, { 'employment.adminManager': null }),
  ]);
  await user.deleteOne();
  ok(res, null, { message: 'Employee deleted' });
});
