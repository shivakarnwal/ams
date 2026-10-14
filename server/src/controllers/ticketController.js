import { env } from '../config/env.js';
import {
  ACTIVE_STATUSES, TICKET_STATUSES, Ticket, TicketCategory, TicketComment, TicketEvent, TicketPriority, nextSeq,
} from '../models/Ticket.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isPrivileged } from '../utils/access.js';
import { TICKET_KINDS, TICKET_TYPES_LABEL, cleanFileName, docInfo } from '../utils/docInfo.js';
import { contentDisposition, streamFile, ticketFiles } from '../utils/gridfs.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok, todayString } from '../utils/helpers.js';
import { DAY_MS, zonedToUtc } from '../utils/time.js';

export const STATUS_LABEL = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', pending: 'Pending', resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled',
};
/** Employees cannot reply once a ticket is closed or cancelled (HR can reopen it). */
const LOCKED = ['closed', 'cancelled'];
const FINISHED = ['resolved', 'closed', 'cancelled'];

const EMP = 'name employeeCode designation department email';
const POP = [
  { path: 'employee', select: EMP },
  { path: 'assignedTo', select: 'name employeeCode role' },
];
const invalid = (errors) => new ApiError(422, 'Validation failed', errors);
const isOwner = (user, t) => String(t.employee?._id || t.employee) === String(user._id);
const populated = (id) => Ticket.findById(id).populate(POP);

/** Owner or HR/Admin; everyone else gets 404 so other people's tickets are not even revealed. */
async function loadTicket(req) {
  if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid ticket id');
  const t = await Ticket.findById(req.params.id);
  if (!t || !(isPrivileged(req.user) || isOwner(req.user, t))) throw ApiError.notFound('Ticket not found');
  return t;
}

const logEvent = (ticket, actor, type, extra = {}) => TicketEvent.create({ ticket: ticket._id, actor: actor._id, type, ...extra });

/** Validates every file first (nothing is stored if one is bad), then stores them. */
async function storeAttachments(files = [], user, ticketId) {
  const checked = files.map((f) => ({ f, info: docInfo(f.buffer, f.originalname) }));
  const bad = checked.find((c) => !c.info || !TICKET_KINDS.includes(c.info.kind));
  if (bad) throw invalid({ attachments: `"${cleanFileName(bad.f.originalname)}" is not allowed. Attach ${TICKET_TYPES_LABEL} (max ${env.ticketAttachmentMaxMb} MB each)` });
  const out = [];
  try {
    for (const { f, info } of checked) {
      const fileName = cleanFileName(f.originalname);
      // eslint-disable-next-line no-await-in-loop
      const fileId = await ticketFiles.put(f.buffer, { filename: fileName, contentType: info.mime, metadata: { ticket: ticketId } });
      out.push({ fileId, fileName, mimeType: info.mime, kind: info.kind, size: f.size, uploadedBy: user._id });
    }
  } catch (err) {
    await ticketFiles.remove(out.map((a) => a.fileId));
    throw err;
  }
  return out;
}

/* ---------------- reference data ---------------- */

export const meta = asyncHandler(async (req, res) => {
  const [categories, priorities] = await Promise.all([
    TicketCategory.find({ active: true }).sort({ order: 1, name: 1 }),
    TicketPriority.find({ active: true }).sort({ level: 1 }),
  ]);
  const data = {
    categories: categories.map((c) => {
      const j = c.toJSON();
      return { id: j.id, name: j.name, description: j.description, subCategories: c.subCategories.filter((s) => s.active).map((s) => ({ name: s.name, issueTypes: s.issueTypes })) };
    }),
    priorities,
    statuses: TICKET_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
    limits: { maxFiles: env.ticketMaxFiles, maxMb: env.ticketAttachmentMaxMb },
  };
  if (isPrivileged(req.user)) {
    data.assignees = await User.find({ role: { $in: ['hr', 'admin'] }, status: 'active' }).select('name employeeCode role designation').sort({ name: 1 });
  }
  ok(res, data);
});

/* ---------------- list / stats ---------------- */

async function scopeFilter(req) {
  const { user } = req;
  const all = req.query.scope === 'all';
  if (all && !isPrivileged(user)) throw ApiError.forbidden('Only HR and Admin can view all tickets');
  return all ? {} : { employee: user._id };
}

const SORT = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  updated: { lastActivityAt: -1 },
  priority: { priorityLevel: -1, createdAt: -1 },
};

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, priority, category, employee, assignee, from, to, q, sort, scope } = req.query;
  const filter = await scopeFilter(req);
  const hrView = scope === 'all';

  if (status) filter.status = status === 'active' ? { $in: ACTIVE_STATUSES } : status;
  if (priority) filter.priority = priority;
  if (category) filter.category = category;
  if (hrView && employee) filter.employee = employee;
  if (hrView && assignee) filter.assignedTo = assignee === 'me' ? req.user._id : assignee === 'unassigned' ? null : assignee;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = zonedToUtc(from, '00:00'); // whole days in APP_TIMEZONE
    if (to) filter.createdAt.$lt = new Date(zonedToUtc(to, '00:00').getTime() + DAY_MS);
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const or = [{ subject: rx }, { ticketNo: rx }, { description: rx }];
    if (hrView) {
      const ids = await User.find({ $or: [{ name: rx }, { employeeCode: rx }] }).limit(200).distinct('_id');
      if (ids.length) or.push({ employee: { $in: ids } });
    }
    filter.$or = or;
  }

  const [items, total] = await Promise.all([
    Ticket.find(filter).sort(SORT[sort] || SORT.newest).skip(skip).limit(limit).populate(POP),
    Ticket.countDocuments(filter),
  ]);
  ok(res, items, { meta: buildMeta(page, limit, total) });
});

export const stats = asyncHandler(async (req, res) => {
  const filter = await scopeFilter(req);
  const rows = await Ticket.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0]));
  for (const r of rows) byStatus[r._id] = r.n;
  const data = {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    active: ACTIVE_STATUSES.reduce((a, s) => a + byStatus[s], 0),
    byStatus,
  };
  if (req.query.scope === 'all') {
    const [unassigned, assignedToMe, createdToday] = await Promise.all([
      Ticket.countDocuments({ status: { $in: ACTIVE_STATUSES }, assignedTo: null }),
      Ticket.countDocuments({ status: { $in: ACTIVE_STATUSES }, assignedTo: req.user._id }),
      Ticket.countDocuments({ createdAt: { $gte: zonedToUtc(todayString(), '00:00') } }),
    ]);
    Object.assign(data, { unassigned, assignedToMe, createdToday });
  }
  ok(res, data);
});

/* ---------------- create / read ---------------- */

export const create = asyncHandler(async (req, res) => {
  const { category, subCategory, issueType, priority, relatedAsset, subject, description } = req.body;

  const cat = await TicketCategory.findOne({ _id: category, active: true });
  if (!cat) throw invalid({ category: 'Choose a valid category' });
  const sub = cat.subCategories.find((s) => s.active && s.name.toLowerCase() === subCategory.toLowerCase());
  if (!sub) throw invalid({ subCategory: `Choose a sub category of ${cat.name}` });
  let issue = '';
  if (issueType) {
    issue = sub.issueTypes.find((i) => i.toLowerCase() === issueType.toLowerCase());
    if (!issue) throw invalid({ issueType: `Choose an issue type of ${sub.name}` });
  }
  const pri = priority
    ? await TicketPriority.findOne({ _id: priority, active: true })
    : (await TicketPriority.findOne({ isDefault: true, active: true })) || (await TicketPriority.findOne({ active: true }).sort({ level: 1 }));
  if (!pri) throw invalid({ priority: 'Choose a valid priority' });

  const attachments = await storeAttachments(req.files, req.user, null);
  const year = Number(todayString().slice(0, 4));
  let ticket;
  try {
    const seq = await nextSeq(`ticket-${year}`);
    ticket = await Ticket.create({
      ticketNo: `TKT-${year}-${String(seq).padStart(5, '0')}`,
      employee: req.user._id,
      category: cat._id, categoryName: cat.name, subCategory: sub.name, issueType: issue,
      priority: pri._id, priorityName: pri.name, priorityLevel: pri.level,
      relatedAsset, subject, description, attachments,
    });
  } catch (err) {
    await ticketFiles.remove(attachments.map((a) => a.fileId));
    throw err;
  }
  await logEvent(ticket, req.user, 'created', { to: 'open', note: subject });
  ok(res, await populated(ticket._id), { message: `Ticket ${ticket.ticketNo} raised` }, 201);
});

function permissions(user, t) {
  const manage = isPrivileged(user);
  const owner = isOwner(user, t);
  return {
    manage,
    reply: manage || (owner && !LOCKED.includes(t.status)),
    internalNotes: manage,
    cancel: owner && ACTIVE_STATUSES.includes(t.status),
  };
}

export const getOne = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  const hidden = isPrivileged(req.user) ? {} : { internal: false };
  const [ticket, comments, events] = await Promise.all([
    populated(t._id),
    TicketComment.find({ ticket: t._id, ...hidden }).sort({ createdAt: 1 }).populate('author', 'name employeeCode role designation'),
    TicketEvent.find({ ticket: t._id, ...hidden }).sort({ createdAt: 1 }).populate('actor', 'name role'),
  ]);
  ok(res, { ...ticket.toJSON(), comments, events, permissions: permissions(req.user, t) });
});

/* ---------------- conversation ---------------- */

export const addComment = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  const privileged = isPrivileged(req.user);
  const owner = isOwner(req.user, t);
  const { body, internal } = req.body;
  const files = req.files || [];

  if (internal && !privileged) throw ApiError.forbidden('Only HR and Admin can add internal notes');
  if (!internal && LOCKED.includes(t.status)) {
    throw ApiError.conflict(privileged ? 'Reopen the ticket before replying to the employee' : 'This ticket is closed. Raise a new ticket or ask HR to reopen it.');
  }
  if (!body && !files.length) throw invalid({ body: 'Write a message or attach a file' });

  const attachments = await storeAttachments(files, req.user, t._id);
  let comment;
  try {
    comment = await TicketComment.create({ ticket: t._id, author: req.user._id, body, internal, attachments });
  } catch (err) {
    await ticketFiles.remove(attachments.map((a) => a.fileId));
    throw err;
  }

  const prevStatus = t.status;
  t.lastActivityAt = new Date();
  if (!internal) t.replyCount += 1;
  if (!internal && privileged && !owner && !t.firstResponseAt) t.firstResponseAt = new Date();
  // "Pending" means waiting on the employee: their reply puts the ticket back into progress
  if (!internal && owner && t.status === 'pending') t.status = 'in_progress';
  await t.save();

  await logEvent(t, req.user, internal ? 'internal_note' : 'comment', { internal, note: (body || `${attachments.length} attachment(s)`).slice(0, 200) });
  if (prevStatus !== t.status) await logEvent(t, req.user, 'status_changed', { from: prevStatus, to: t.status, note: 'Employee responded' });

  await comment.populate('author', 'name employeeCode role designation');
  ok(res, { comment, status: t.status }, { message: internal ? 'Internal note added' : 'Reply sent' }, 201);
});

/* ---------------- HR / Admin actions ---------------- */

export const assign = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  if (LOCKED.includes(t.status)) throw ApiError.conflict('Reopen the ticket before assigning it');
  const { assignee } = req.body;
  let user = null;
  if (assignee) {
    user = await User.findOne({ _id: assignee, role: { $in: ['hr', 'admin'] }, status: 'active' }).select('name');
    if (!user) throw invalid({ assignee: 'Tickets can be assigned to active HR or Admin users only' });
  }
  if (String(t.assignedTo || '') === String(user?._id || '')) return ok(res, await populated(t._id), { message: 'No change' });

  const prev = t.assignedTo ? await User.findById(t.assignedTo).select('name') : null;
  const prevStatus = t.status;
  t.assignedTo = user?._id ?? null;
  t.assignedAt = user ? new Date() : undefined;
  if (user && t.status === 'open') t.status = 'assigned';
  if (!user && t.status === 'assigned') t.status = 'open';
  t.lastActivityAt = new Date();
  await t.save();

  await logEvent(t, req.user, user ? 'assigned' : 'unassigned', { from: prev?.name || '', to: user?.name || '' });
  if (prevStatus !== t.status) await logEvent(t, req.user, 'status_changed', { from: prevStatus, to: t.status });
  ok(res, await populated(t._id), { message: user ? `Assigned to ${user.name}` : 'Ticket unassigned' });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  const { status, note } = req.body;
  if (status === t.status) throw ApiError.conflict(`Ticket is already ${STATUS_LABEL[status]}`);
  if (status === 'assigned' && !t.assignedTo) throw invalid({ status: 'Assign the ticket to someone first' });

  const prev = t.status;
  const reopened = FINISHED.includes(prev) && ACTIVE_STATUSES.includes(status);
  t.status = status;
  t.lastActivityAt = new Date();
  if (status === 'resolved') t.resolvedAt = new Date();
  if (status === 'closed') t.closedAt = new Date();
  if (reopened) {
    t.resolvedAt = undefined;
    t.closedAt = undefined;
  }
  if (note) {
    // the reason is shared with the employee in the conversation
    await TicketComment.create({ ticket: t._id, author: req.user._id, body: note });
    t.replyCount += 1;
    if (!t.firstResponseAt && !isOwner(req.user, t)) t.firstResponseAt = new Date();
  }
  await t.save();
  await logEvent(t, req.user, reopened ? 'reopened' : status === 'cancelled' ? 'cancelled' : 'status_changed', { from: prev, to: status, note });
  ok(res, await populated(t._id), { message: reopened ? `Ticket reopened (${STATUS_LABEL[status]})` : `Status changed to ${STATUS_LABEL[status]}` });
});

export const changePriority = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  const p = await TicketPriority.findOne({ _id: req.body.priority, active: true });
  if (!p) throw invalid({ priority: 'Choose a valid priority' });
  if (String(p._id) === String(t.priority)) return ok(res, await populated(t._id), { message: 'No change' });
  const from = t.priorityName;
  t.set({ priority: p._id, priorityName: p.name, priorityLevel: p.level, lastActivityAt: new Date() });
  await t.save();
  await logEvent(t, req.user, 'priority_changed', { from, to: p.name });
  ok(res, await populated(t._id), { message: `Priority changed to ${p.name}` });
});

/** The employee withdraws their own ticket. */
export const cancel = asyncHandler(async (req, res) => {
  const t = await loadTicket(req);
  if (!isOwner(req.user, t)) throw ApiError.forbidden('Only the person who raised the ticket can cancel it');
  if (!ACTIVE_STATUSES.includes(t.status)) throw ApiError.conflict(`A ${STATUS_LABEL[t.status].toLowerCase()} ticket cannot be cancelled`);
  const prev = t.status;
  t.status = 'cancelled';
  t.lastActivityAt = new Date();
  await t.save();
  await logEvent(t, req.user, 'cancelled', { from: prev, to: 'cancelled', note: req.body.reason });
  ok(res, await populated(t._id), { message: 'Ticket cancelled' });
});

/* ---------------- attachments ---------------- */

export const attachment = asyncHandler(async (req, res, next) => {
  const t = await loadTicket(req);
  const attId = req.params.attachmentId;
  if (!isValidId(attId)) throw ApiError.badRequest('Invalid attachment id');
  let att = t.attachments.id(attId);
  if (!att) {
    const c = await TicketComment.findOne({ ticket: t._id, 'attachments._id': attId, ...(isPrivileged(req.user) ? {} : { internal: false }) });
    att = c?.attachments.id(attId);
  }
  if (!att) throw ApiError.notFound('Attachment not found');

  const inline = req.query.inline === 'true' && (att.kind === 'image' || att.kind === 'pdf');
  res.status(200).set({
    'Content-Type': att.mimeType,
    'Content-Length': String(att.size),
    'Content-Disposition': contentDisposition(att.fileName, inline ? 'inline' : 'attachment'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  streamFile(ticketFiles, att.fileId, res, next, ApiError.notFound('Attachment file not found'));
});
