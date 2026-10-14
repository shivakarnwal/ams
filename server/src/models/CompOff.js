import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const compOffSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workDate: { type: Date, required: true },
    dutyHours: { type: Number, required: true, min: 0, max: 24 },
    appliedFor: { type: String, enum: ['full', 'half'], required: true },
    reason: { type: String, trim: true, required: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
    credited: { type: Boolean, default: false },
  },
  { timestamps: true },
);
compOffSchema.index({ employee: 1, workDate: 1 }, { unique: true });
jsonPlugin(compOffSchema);

export const CompOff = mongoose.models.CompOff || mongoose.model('CompOff', compOffSchema);
