import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    probationEndDate: { type: Date, required: true },
    confirmationDate: Date,
    status: { type: String, enum: ['pending', 'confirmed', 'extended', 'rejected'], default: 'pending', index: true },
    extendedTill: Date,
    remarks: { type: String, trim: true, default: '', maxlength: 1000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true },
);
jsonPlugin(schema);

export const Confirmation = mongoose.models.Confirmation || mongoose.model('Confirmation', schema);
