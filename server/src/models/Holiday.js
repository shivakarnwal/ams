import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: Date, required: true, index: true },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);
schema.index({ date: 1, name: 1 }, { unique: true });
jsonPlugin(schema);

export const Holiday = mongoose.models.Holiday || mongoose.model('Holiday', schema);
