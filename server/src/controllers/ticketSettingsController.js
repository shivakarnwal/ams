import { Ticket, TicketCategory, TicketPriority } from '../models/Ticket.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, isValidId, ok } from '../utils/helpers.js';

/** HR / Admin: manage ticket categories (with sub categories + issue types) and priorities. */

const invalid = (errors) => new ApiError(422, 'Validation failed', errors);
const dup = (err, msg) => (err?.code === 11000 ? ApiError.conflict(msg) : err);

async function load(Model, id, label) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid id');
  const doc = await Model.findById(id);
  if (!doc) throw ApiError.notFound(`${label} not found`);
  return doc;
}

async function usage(field) {
  const rows = await Ticket.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/* ---- categories ---- */

export const listCategories = asyncHandler(async (_req, res) => {
  const [cats, used] = await Promise.all([TicketCategory.find().sort({ order: 1, name: 1 }), usage('category')]);
  ok(res, cats.map((c) => ({ ...c.toJSON(), ticketCount: used.get(String(c._id)) || 0 })));
});

export const createCategory = asyncHandler(async (req, res) => {
  const order = req.body.order ?? (await TicketCategory.countDocuments());
  try {
    const c = await TicketCategory.create({ ...req.body, order, updatedBy: req.user._id });
    ok(res, { ...c.toJSON(), ticketCount: 0 }, { message: 'Category created' }, 201);
  } catch (err) {
    throw dup(err, `A category named "${req.body.name}" already exists`);
  }
});

export const updateCategory = asyncHandler(async (req, res) => {
  const c = await load(TicketCategory, req.params.id, 'Category');
  c.set({ ...req.body, updatedBy: req.user._id });
  try {
    await c.save();
  } catch (err) {
    throw dup(err, `A category named "${req.body.name}" already exists`);
  }
  // existing tickets keep the names they were raised with (snapshots), so nothing else changes
  ok(res, c, { message: 'Category updated' });
});

export const removeCategory = asyncHandler(async (req, res) => {
  const c = await load(TicketCategory, req.params.id, 'Category');
  const n = await Ticket.countDocuments({ category: c._id });
  if (n) throw ApiError.conflict(`${n} ticket${n === 1 ? ' uses' : 's use'} "${c.name}". Deactivate it instead so it is hidden from new tickets.`);
  await c.deleteOne();
  ok(res, null, { message: 'Category deleted' });
});

/* ---- priorities ---- */

export const listPriorities = asyncHandler(async (_req, res) => {
  const [list, used] = await Promise.all([TicketPriority.find().sort({ level: 1 }), usage('priority')]);
  ok(res, list.map((p) => ({ ...p.toJSON(), ticketCount: used.get(String(p._id)) || 0 })));
});

/** Exactly one active priority is the default for new tickets. */
const clearOtherDefaults = (id) => TicketPriority.updateMany({ _id: { $ne: id }, isDefault: true }, { isDefault: false });

export const createPriority = asyncHandler(async (req, res) => {
  if (req.body.isDefault && req.body.active === false) throw invalid({ isDefault: 'The default priority must be active' });
  try {
    const p = await TicketPriority.create({ ...req.body, updatedBy: req.user._id });
    if (p.isDefault) await clearOtherDefaults(p._id);
    ok(res, { ...p.toJSON(), ticketCount: 0 }, { message: 'Priority created' }, 201);
  } catch (err) {
    throw dup(err, `A priority named "${req.body.name}" already exists`);
  }
});

export const updatePriority = asyncHandler(async (req, res) => {
  const p = await load(TicketPriority, req.params.id, 'Priority');
  const next = { ...p.toObject(), ...req.body };
  if (p.isDefault && req.body.isDefault === false) throw invalid({ isDefault: 'Make another priority the default instead' });
  if (next.isDefault && next.active === false) throw invalid({ active: 'The default priority cannot be deactivated' });
  p.set({ ...req.body, updatedBy: req.user._id });
  try {
    await p.save();
  } catch (err) {
    throw dup(err, `A priority named "${req.body.name}" already exists`);
  }
  if (p.isDefault) await clearOtherDefaults(p._id);
  ok(res, p, { message: 'Priority updated' });
});

export const removePriority = asyncHandler(async (req, res) => {
  const p = await load(TicketPriority, req.params.id, 'Priority');
  if (p.isDefault) throw ApiError.conflict('The default priority cannot be deleted. Make another priority the default first.');
  const n = await Ticket.countDocuments({ priority: p._id });
  if (n) throw ApiError.conflict(`${n} ticket${n === 1 ? ' uses' : 's use'} "${p.name}". Deactivate it instead.`);
  await p.deleteOne();
  ok(res, null, { message: 'Priority deleted' });
});
