import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'];
/** Statuses where work is still outstanding */
export const ACTIVE_STATUSES = ['open', 'assigned', 'in_progress', 'pending'];
export const DONE_STATUSES = ['resolved', 'closed', 'cancelled'];
export const PRIORITY_COLORS = ['slate', 'blue', 'amber', 'red', 'purple', 'green'];
export const EVENT_TYPES = [
  'created', 'status_changed', 'reopened', 'assigned', 'unassigned', 'priority_changed', 'comment', 'internal_note', 'cancelled', 'attachment',
];

/* ---------------- settings ---------------- */

const subCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    active: { type: Boolean, default: true },
    issueTypes: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
  },
  { _id: true },
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Category name is required'], trim: true, maxlength: 60 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    subCategories: { type: [subCategorySchema], default: [] },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
jsonPlugin(categorySchema);

const prioritySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Priority name is required'], trim: true, maxlength: 30 },
    /** Higher = more urgent; used for sorting */
    level: { type: Number, required: true, min: 1, max: 10 },
    color: { type: String, enum: PRIORITY_COLORS, default: 'blue' },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
prioritySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
jsonPlugin(prioritySchema);

/* ---------------- tickets ---------------- */

const attachmentSchema = new mongoose.Schema(
  {
    fileId: { type: ObjectId, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    kind: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    uploadedBy: { type: ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

/** Hides storage ids; attachments are downloaded through the API by their own id. */
function stripFiles(ret) {
  ret.id = String(ret._id);
  delete ret._id;
  if (Array.isArray(ret.attachments)) {
    ret.attachments = ret.attachments.map(({ fileId, _id, ...a }) => ({ ...a, id: String(_id) })); // eslint-disable-line no-unused-vars
  }
  return ret;
}

const ticketSchema = new mongoose.Schema(
  {
    ticketNo: { type: String, required: true, unique: true },
    employee: { type: ObjectId, ref: 'User', required: true, index: true },
    category: { type: ObjectId, ref: 'TicketCategory', required: true, index: true },
    // names are snapshotted so renaming/removing a setting never rewrites history
    categoryName: { type: String, required: true },
    subCategory: { type: String, required: true, trim: true, maxlength: 80 },
    issueType: { type: String, trim: true, default: '', maxlength: 80 },
    priority: { type: ObjectId, ref: 'TicketPriority', required: true, index: true },
    priorityName: { type: String, required: true },
    priorityLevel: { type: Number, required: true },
    relatedAsset: { type: String, trim: true, default: '', maxlength: 100 },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    assignedTo: { type: ObjectId, ref: 'User', default: null, index: true },
    assignedAt: Date,
    firstResponseAt: Date,
    resolvedAt: Date,
    closedAt: Date,
    lastActivityAt: { type: Date, default: () => new Date() },
    attachments: { type: [attachmentSchema], default: [] },
    replyCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ status: 1, priorityLevel: -1, createdAt: -1 });
ticketSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (_d, ret) => stripFiles(ret) });

const commentSchema = new mongoose.Schema(
  {
    ticket: { type: ObjectId, ref: 'Ticket', required: true, index: true },
    author: { type: ObjectId, ref: 'User', required: true },
    body: { type: String, trim: true, default: '', maxlength: 5000 },
    /** Internal notes are visible to HR/Admin only */
    internal: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true },
);
commentSchema.index({ ticket: 1, createdAt: 1 });
commentSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (_d, ret) => stripFiles(ret) });

/** Append-only audit trail of everything that happened to a ticket. */
const eventSchema = new mongoose.Schema(
  {
    ticket: { type: ObjectId, ref: 'Ticket', required: true, index: true },
    actor: { type: ObjectId, ref: 'User' },
    type: { type: String, enum: EVENT_TYPES, required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 2000 },
    internal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ ticket: 1, createdAt: 1 });
jsonPlugin(eventSchema);

/** Monotonic counters (ticket numbers). */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const TicketCategory = mongoose.models.TicketCategory || mongoose.model('TicketCategory', categorySchema);
export const TicketPriority = mongoose.models.TicketPriority || mongoose.model('TicketPriority', prioritySchema);
export const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
export const TicketComment = mongoose.models.TicketComment || mongoose.model('TicketComment', commentSchema);
export const TicketEvent = mongoose.models.TicketEvent || mongoose.model('TicketEvent', eventSchema);
export const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

export async function nextSeq(key) {
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}
