import { Candidate } from '../models/Candidate.js';
import { Confirmation } from '../models/Confirmation.js';
import { ManpowerRequisition } from '../models/ManpowerRequisition.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok } from '../utils/helpers.js';
import { canAccessEmployee, isPrivileged, isReviewer, ownerFilter } from '../utils/access.js';

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const need = (cond, err = ApiError.forbidden()) => { if (!cond) throw err; };
async function load(Model, id, label) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid id');
  const doc = await Model.findById(id);
  if (!doc) throw ApiError.notFound(`${label} not found`);
  return doc;
}
const dateRange = (q, filter, field = 'createdAt') => {
  const r = {};
  if (s(q.from)) r.$gte = new Date(s(q.from));
  if (s(q.to)) { const t = new Date(s(q.to)); t.setUTCHours(23, 59, 59, 999); r.$lte = t; }
  if (Object.keys(r).length) filter[field] = r;
};

/* =============== Manpower requisitions =============== */
const REQ_POP = [
  { path: 'requestedBy', select: 'name employeeCode' },
  { path: 'reportingTo', select: 'name employeeCode designation' },
  { path: 'reviewedBy', select: 'name' },
];
const reqOwnerOrPrivileged = (req, doc) => isPrivileged(req.user) || String(doc.requestedBy) === String(req.user._id);

export const manpower = {
  list: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    if (!isPrivileged(req.user)) filter.requestedBy = req.user._id;
    for (const f of ['status', 'department', 'location']) if (s(req.query[f])) filter[f] = s(req.query[f]);
    if (s(req.query.q)) filter.jobTitle = new RegExp(escapeRegex(s(req.query.q)), 'i');
    dateRange(req.query, filter);
    const [items, total] = await Promise.all([
      ManpowerRequisition.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(REQ_POP),
      ManpowerRequisition.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  }),
  getOne: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(ManpowerRequisition, req.params.id, 'Requisition');
    need(reqOwnerOrPrivileged(req, doc));
    ok(res, await doc.populate(REQ_POP));
  }),
  create: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    if (req.body.reportingTo && !(await User.exists({ _id: req.body.reportingTo }))) throw ApiError.badRequest('Reporting manager not found');
    const doc = await ManpowerRequisition.create({ ...req.body, requestedBy: req.user._id, status: 'pending' });
    ok(res, await doc.populate(REQ_POP), { message: 'Manpower requisition submitted' }, 201);
  }),
  update: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(ManpowerRequisition, req.params.id, 'Requisition');
    need(reqOwnerOrPrivileged(req, doc));
    if (doc.status !== 'pending') throw ApiError.conflict('Only pending requisitions can be edited');
    doc.set(req.body);
    await doc.save();
    ok(res, await doc.populate(REQ_POP), { message: 'Requisition updated' });
  }),
  review: asyncHandler(async (req, res) => {
    need(isPrivileged(req.user));
    const doc = await load(ManpowerRequisition, req.params.id, 'Requisition');
    const allowed = { pending: ['approved', 'rejected'], approved: ['closed'] };
    if (!(allowed[doc.status] || []).includes(req.body.status)) throw ApiError.conflict(`Cannot change status from "${doc.status}" to "${req.body.status}"`);
    Object.assign(doc, { status: req.body.status, remarks: req.body.remarks, reviewedBy: req.user._id, reviewedAt: new Date() });
    await doc.save();
    ok(res, await doc.populate(REQ_POP), { message: `Requisition ${doc.status}` });
  }),
  remove: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(ManpowerRequisition, req.params.id, 'Requisition');
    need(isPrivileged(req.user) || (String(doc.requestedBy) === String(req.user._id) && doc.status === 'pending'));
    await Candidate.updateMany({ requisition: doc._id }, { $unset: { requisition: 1 } });
    await doc.deleteOne();
    ok(res, null, { message: 'Requisition deleted' });
  }),
};

/* =============== Candidates (requests + interview evaluation) =============== */
const CAND_POP = [{ path: 'requisition', select: 'jobTitle department' }, { path: 'interview.evaluatedBy', select: 'name' }];

export const candidates = {
  list: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    for (const f of ['stage', 'status', 'requisition']) if (s(req.query[f])) filter[f] = s(req.query[f]);
    if (s(req.query.q)) {
      const rx = new RegExp(escapeRegex(s(req.query.q)), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { jobTitle: rx }];
    }
    const [items, total] = await Promise.all([
      Candidate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(CAND_POP),
      Candidate.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  }),
  create: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    if (req.body.requisition && !(await ManpowerRequisition.exists({ _id: req.body.requisition }))) throw ApiError.badRequest('Requisition not found');
    const doc = await Candidate.create({ ...req.body, createdBy: req.user._id });
    ok(res, await doc.populate(CAND_POP), { message: 'Candidate added' }, 201);
  }),
  update: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(Candidate, req.params.id, 'Candidate');
    if (doc.stage !== 'request') throw ApiError.conflict('Only candidates awaiting approval can be edited');
    doc.set(req.body);
    await doc.save();
    ok(res, await doc.populate(CAND_POP), { message: 'Candidate updated' });
  }),
  decide: asyncHandler(async (req, res) => {
    need(isPrivileged(req.user));
    const doc = await load(Candidate, req.params.id, 'Candidate');
    if (doc.stage !== 'request') throw ApiError.conflict('This candidate has already been processed');
    if (req.body.decision === 'approve') Object.assign(doc, { stage: 'interview', status: 'approved' });
    else Object.assign(doc, { stage: 'closed', status: 'rejected' });
    await doc.save();
    ok(res, await doc.populate(CAND_POP), { message: `Candidate ${doc.status}` });
  }),
  evaluate: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(Candidate, req.params.id, 'Candidate');
    if (doc.stage !== 'interview') throw ApiError.conflict('Candidate is not in the interview stage');
    doc.interview = { rating: req.body.rating, feedback: req.body.feedback, evaluatedBy: req.user._id, evaluatedAt: new Date() };
    doc.stage = 'closed';
    doc.status = req.body.result;
    await doc.save();
    ok(res, await doc.populate(CAND_POP), { message: `Candidate ${doc.status}` });
  }),
  remove: asyncHandler(async (req, res) => {
    need(isPrivileged(req.user));
    const doc = await load(Candidate, req.params.id, 'Candidate');
    await doc.deleteOne();
    ok(res, null, { message: 'Candidate deleted' });
  }),
};

/* =============== Confirmations =============== */
const CONF_POP = [{ path: 'employee', select: 'name employeeCode designation department dateOfJoining' }, { path: 'reviewedBy', select: 'name' }];

export const confirmations = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query);
    const filter = await ownerFilter(req);
    if (s(req.query.status)) filter.status = s(req.query.status);
    const [items, total] = await Promise.all([
      Confirmation.find(filter).sort({ probationEndDate: 1 }).skip(skip).limit(limit).populate(CONF_POP),
      Confirmation.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  }),
  getOne: asyncHandler(async (req, res) => {
    const doc = await load(Confirmation, req.params.id, 'Confirmation');
    need(await canAccessEmployee(req.user, doc.employee));
    ok(res, await doc.populate(CONF_POP));
  }),
  create: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    need(await canAccessEmployee(req.user, req.body.employee));
    if (!(await User.exists({ _id: req.body.employee }))) throw ApiError.badRequest('Employee not found');
    if (await Confirmation.exists({ employee: req.body.employee, status: 'pending' })) throw ApiError.conflict('A pending confirmation already exists for this employee');
    const doc = await Confirmation.create(req.body);
    ok(res, await doc.populate(CONF_POP), { message: 'Confirmation record created' }, 201);
  }),
  update: asyncHandler(async (req, res) => {
    need(isReviewer(req.user));
    const doc = await load(Confirmation, req.params.id, 'Confirmation');
    need(await canAccessEmployee(req.user, doc.employee));
    if (doc.status !== 'pending') throw ApiError.conflict('Only pending confirmations can be edited');
    doc.set(req.body);
    await doc.save();
    ok(res, await doc.populate(CONF_POP), { message: 'Confirmation updated' });
  }),
  review: asyncHandler(async (req, res) => {
    need(isPrivileged(req.user));
    const doc = await load(Confirmation, req.params.id, 'Confirmation');
    if (!['pending', 'extended'].includes(doc.status)) throw ApiError.conflict('This confirmation has already been finalised');
    Object.assign(doc, {
      status: req.body.status, remarks: req.body.remarks, reviewedBy: req.user._id, reviewedAt: new Date(),
      confirmationDate: req.body.status === 'confirmed' ? new Date() : undefined,
      extendedTill: req.body.status === 'extended' ? req.body.extendedTill : undefined,
    });
    await doc.save();
    ok(res, await doc.populate(CONF_POP), { message: `Employee ${doc.status}` });
  }),
  remove: asyncHandler(async (req, res) => {
    need(isPrivileged(req.user));
    const doc = await load(Confirmation, req.params.id, 'Confirmation');
    await doc.deleteOne();
    ok(res, null, { message: 'Confirmation deleted' });
  }),
};
