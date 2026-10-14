import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

export const REG_TYPES = ['in-punch', 'out-punch', 'on-duty', 'wfh'];

const regularizationSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: REG_TYPES, required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** HH:mm — required for in-punch / out-punch */
    time: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    reason: { type: String, trim: true, default: '', maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);
regularizationSchema.index({ employee: 1, date: -1 });
jsonPlugin(regularizationSchema);

export const Regularization = mongoose.models.Regularization || mongoose.model('Regularization', regularizationSchema);
