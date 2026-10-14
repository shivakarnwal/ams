import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const visitorSchema = new mongoose.Schema(
  {
    /** The host employee who raised the request */
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    visitorName: { type: String, required: true, trim: true, maxlength: 120 },
    company: { type: String, trim: true, default: '' },
    contactNumber: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },
    visitDate: { type: Date, required: true },
    expectedTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    numberOfVisitors: { type: Number, default: 1, min: 1, max: 50 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);
visitorSchema.index({ visitDate: -1 });
jsonPlugin(visitorSchema);

export const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
