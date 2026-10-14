import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, buildMeta, getPagination, isValidId, ok } from '../utils/helpers.js';
import { canAccessEmployee, isPrivileged, isReviewer, ownerFilter } from '../utils/access.js';

const EMPLOYEE_FIELDS = 'name employeeCode designation department email';

/**
 * Factory for "employee raises a request -> manager/HR reviews it" resources
 * (leave, comp-off, regularization, visitor, travel expense).
 *
 * config:
 *  Model, label, ownerField, populate, filterFields, dateField (+ dateIsString), statsGroupField
 *  transitions: { [fromStatus]: [allowed next statuses] }   (review)
 *  cancellableFrom: statuses the owner may cancel from
 *  hooks: prepareCreate(data, req), prepareUpdate(doc, data, req), onReview(doc, prev, next, req),
 *         onCancel(doc, prev, req), beforeDelete(doc, req)
 */
export function createRequestController(config) {
  const {
    Model, label, ownerField = 'employee', filterFields = ['status'], dateField, dateIsString = false,
    statsGroupField, cancellableFrom = ['pending'], hooks = {},
    transitions = { pending: ['approved', 'rejected'] },
    populate = [{ path: ownerField, select: EMPLOYEE_FIELDS }, { path: 'reviewedBy', select: 'name employeeCode' }],
  } = config;

  const notFound = () => ApiError.notFound(`${label} not found`);

  async function load(req) {
    if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid id');
    const doc = await Model.findById(req.params.id);
    if (!doc) throw notFound();
    return doc;
  }

  async function loadWithAccess(req) {
    const doc = await load(req);
    if (!(await canAccessEmployee(req.user, doc[ownerField]))) throw ApiError.forbidden();
    return doc;
  }

  const isOwner = (req, doc) => String(doc[ownerField]) === String(req.user._id);
  const populated = (id) => Model.findById(id).populate(populate);

  const list = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query);
    const filter = await ownerFilter(req, ownerField);
    for (const f of filterFields) if (typeof req.query[f] === 'string' && req.query[f]) filter[f] = req.query[f];
    const { from, to } = req.query;
    if (dateField && (typeof from === 'string' || typeof to === 'string')) {
      const conv = (v) => (dateIsString ? v : new Date(v));
      const range = {};
      if (typeof from === 'string' && from) range.$gte = conv(from);
      if (typeof to === 'string' && to) range.$lte = conv(to);
      if (Object.keys(range).length) filter[dateField] = range;
    }
    const [items, total] = await Promise.all([
      Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(populate),
      Model.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  });

  const stats = asyncHandler(async (req, res) => {
    const filter = await ownerFilter(req, ownerField);
    const docs = await Model.find(filter).select(`status ${statsGroupField || ''}`.trim()).lean();
    const byStatus = {};
    const byGroup = {};
    for (const d of docs) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      if (statsGroupField) byGroup[d[statsGroupField]] = (byGroup[d[statsGroupField]] || 0) + 1;
    }
    ok(res, { total: docs.length, byStatus, ...(statsGroupField ? { byGroup } : {}) });
  });

  const getOne = asyncHandler(async (req, res) => {
    const doc = await loadWithAccess(req);
    ok(res, await populated(doc._id));
  });

  const create = asyncHandler(async (req, res) => {
    let data = { ...req.body, [ownerField]: req.user._id, status: 'pending' };
    if (hooks.prepareCreate) data = (await hooks.prepareCreate(data, req)) || data;
    const doc = await Model.create(data);
    if (hooks.afterCreate) await hooks.afterCreate(doc, req);
    ok(res, await populated(doc._id), { message: `${label} submitted successfully` }, 201);
  });

  const update = asyncHandler(async (req, res) => {
    const doc = await load(req);
    if (!isOwner(req, doc) && !isPrivileged(req.user)) throw ApiError.forbidden();
    if (doc.status !== 'pending') throw ApiError.conflict(`Only pending ${label.toLowerCase()}s can be edited`);
    let data = { ...req.body };
    if (hooks.prepareUpdate) data = (await hooks.prepareUpdate(doc, data, req)) || data;
    doc.set(data);
    await doc.save();
    ok(res, await populated(doc._id), { message: `${label} updated successfully` });
  });

  const review = asyncHandler(async (req, res) => {
    const doc = await load(req);
    if (!isReviewer(req.user)) throw ApiError.forbidden();
    if (isOwner(req, doc) && req.user.role !== 'admin') throw ApiError.forbidden('You cannot review your own request');
    if (!(await canAccessEmployee(req.user, doc[ownerField]))) throw ApiError.forbidden();

    const next = req.body.status;
    const prev = doc.status;
    if (!(transitions[prev] || []).includes(next)) {
      throw ApiError.conflict(`Cannot change status from "${prev}" to "${next}"`);
    }
    const claimed = await Model.findOneAndUpdate(
      { _id: doc._id, status: prev },
      { status: next, reviewedBy: req.user._id, reviewedAt: new Date(), remarks: req.body.remarks || '' },
      { new: true },
    );
    if (!claimed) throw ApiError.conflict(`${label} was already processed`);
    try {
      if (hooks.onReview) await hooks.onReview(claimed, prev, next, req);
    } catch (err) {
      await Model.updateOne({ _id: doc._id }, { status: prev, $unset: { reviewedBy: 1, reviewedAt: 1 }, remarks: doc.remarks });
      throw err;
    }
    ok(res, await populated(doc._id), { message: `${label} ${next}` });
  });

  const cancel = asyncHandler(async (req, res) => {
    const doc = await load(req);
    if (!isOwner(req, doc) && req.user.role !== 'admin') throw ApiError.forbidden();
    const prev = doc.status;
    if (!cancellableFrom.includes(prev)) throw ApiError.conflict(`A ${prev} ${label.toLowerCase()} cannot be cancelled`);
    const claimed = await Model.findOneAndUpdate({ _id: doc._id, status: prev }, { status: 'cancelled' }, { new: true });
    if (!claimed) throw ApiError.conflict(`${label} was already processed`);
    try {
      if (hooks.onCancel) await hooks.onCancel(claimed, prev, req);
    } catch (err) {
      await Model.updateOne({ _id: doc._id }, { status: prev });
      throw err;
    }
    ok(res, await populated(doc._id), { message: `${label} cancelled` });
  });

  const remove = asyncHandler(async (req, res) => {
    const doc = await load(req);
    const admin = req.user.role === 'admin';
    if (!admin && !(isOwner(req, doc) && doc.status === 'pending')) {
      throw ApiError.forbidden('Only pending requests can be deleted by their owner');
    }
    if (hooks.beforeDelete) await hooks.beforeDelete(doc, req);
    await doc.deleteOne();
    ok(res, null, { message: `${label} deleted` });
  });

  return { list, stats, getOne, create, update, review, cancel, remove };
}
