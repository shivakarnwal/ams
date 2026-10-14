import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const schema = new mongoose.Schema(
  {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobTitle: { type: String, required: true, trim: true, maxlength: 150 },
    startingDate: { type: Date, required: true },
    department: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    reportingTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vacancies: { type: Number, default: 1, min: 1, max: 500 },
    justification: { type: String, trim: true, default: '', maxlength: 1500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'closed'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
jsonPlugin(schema);

export const ManpowerRequisition = mongoose.models.ManpowerRequisition || mongoose.model('ManpowerRequisition', schema);
