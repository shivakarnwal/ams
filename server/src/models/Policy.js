import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;
export const FOLDER_COLORS = ['blue', 'purple', 'orange', 'sky', 'green', 'rose', 'amber', 'slate'];

/** A folder on the HR Policies page (e.g. "Leave", "IT & BYOD", "Medical"). */
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Folder name is required'], trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
    color: { type: String, enum: FOLDER_COLORS, default: 'blue' },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
jsonPlugin(categorySchema);

/** One uploaded document revision. Files are never overwritten: replacing a policy adds a version. */
const versionSchema = new mongoose.Schema(
  {
    policy: { type: ObjectId, ref: 'Policy', required: true, index: true },
    version: { type: String, required: true, trim: true, maxlength: 20 },
    effectiveDate: { type: Date, required: true },
    changeNote: { type: String, trim: true, default: '', maxlength: 500 },
    fileId: { type: ObjectId, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    kind: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    checksum: { type: String, required: true },
    uploadedBy: { type: ObjectId, ref: 'User' },
    downloadCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
versionSchema.index({ policy: 1, version: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
versionSchema.index({ policy: 1, createdAt: -1 });
versionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.fileId; // downloads go through the API, never straight to storage
    return ret;
  },
});

const policySchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 150 },
    category: { type: ObjectId, ref: 'PolicyCategory', required: true, index: true },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    /** Effective date of the current version */
    effectiveDate: { type: Date, required: true },
    currentVersion: { type: ObjectId, ref: 'PolicyVersion' },
    versionCount: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
policySchema.index({ category: 1, title: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
policySchema.index({ updatedAt: -1 });
jsonPlugin(policySchema);

export const PolicyCategory = mongoose.models.PolicyCategory || mongoose.model('PolicyCategory', categorySchema);
export const PolicyVersion = mongoose.models.PolicyVersion || mongoose.model('PolicyVersion', versionSchema);
export const Policy = mongoose.models.Policy || mongoose.model('Policy', policySchema);
