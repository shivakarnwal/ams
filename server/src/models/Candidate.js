import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const schema = new mongoose.Schema(
  {
    requisition: { type: mongoose.Schema.Types.ObjectId, ref: 'ManpowerRequisition', index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contact: { type: String, trim: true, default: '' },
    email: { type: String, required: true, trim: true, lowercase: true },
    jobTitle: { type: String, required: true, trim: true },
    startingDate: { type: Date },
    /** request -> awaiting approval, interview -> approved & being evaluated, closed -> final decision made */
    stage: { type: String, enum: ['request', 'interview', 'closed'], default: 'request', index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'selected'], default: 'pending', index: true },
    interview: {
      rating: { type: Number, min: 1, max: 5 },
      feedback: { type: String, trim: true, default: '' },
      evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      evaluatedAt: Date,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
jsonPlugin(schema);

export const Candidate = mongoose.models.Candidate || mongoose.model('Candidate', schema);
