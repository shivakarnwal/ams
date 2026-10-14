import { Announcement } from '../models/Announcement.js';
import { Holiday } from '../models/Holiday.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, buildMeta, getPagination, isValidId, ok, todayString } from '../utils/helpers.js';

async function load(Model, id, label) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid id');
  const doc = await Model.findById(id);
  if (!doc) throw ApiError.notFound(`${label} not found`);
  return doc;
}

export const holidays = {
  list: asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.upcoming === 'true') filter.date = { $gte: new Date(todayString()) };
    else if (/^\d{4}$/.test(String(req.query.year || ''))) {
      const y = Number(req.query.year);
      filter.date = { $gte: new Date(Date.UTC(y, 0, 1)), $lt: new Date(Date.UTC(y + 1, 0, 1)) };
    }
    const { page, limit, skip } = getPagination(req.query, { defaultLimit: 50 });
    const [items, total] = await Promise.all([
      Holiday.find(filter).sort({ date: 1 }).skip(skip).limit(limit),
      Holiday.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  }),
  create: asyncHandler(async (req, res) => ok(res, await Holiday.create(req.body), { message: 'Holiday added' }, 201)),
  update: asyncHandler(async (req, res) => {
    const doc = await load(Holiday, req.params.id, 'Holiday');
    doc.set(req.body);
    await doc.save();
    ok(res, doc, { message: 'Holiday updated' });
  }),
  remove: asyncHandler(async (req, res) => {
    await (await load(Holiday, req.params.id, 'Holiday')).deleteOne();
    ok(res, null, { message: 'Holiday deleted' });
  }),
};

export const announcements = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query, { defaultLimit: 10 });
    const [items, total] = await Promise.all([
      Announcement.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name'),
      Announcement.countDocuments(),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  }),
  create: asyncHandler(async (req, res) => {
    const doc = await Announcement.create({ ...req.body, createdBy: req.user._id });
    ok(res, doc, { message: 'Announcement published' }, 201);
  }),
  update: asyncHandler(async (req, res) => {
    const doc = await load(Announcement, req.params.id, 'Announcement');
    doc.set(req.body);
    await doc.save();
    ok(res, doc, { message: 'Announcement updated' });
  }),
  remove: asyncHandler(async (req, res) => {
    await (await load(Announcement, req.params.id, 'Announcement')).deleteOne();
    ok(res, null, { message: 'Announcement deleted' });
  }),
};
