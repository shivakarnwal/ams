import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const schema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, trim: true, default: '', maxlength: 3000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
jsonPlugin(schema);

export const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', schema);
