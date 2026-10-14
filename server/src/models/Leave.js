import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

export const LEAVE_TYPES = ['sick', 'earned', 'casual', 'comp_off', 'maternity'];
/** leave type -> key inside User.leaveBalance */
export const BALANCE_KEY = { sick: 'sick', earned: 'earned', casual: 'casual', comp_off: 'compOff', maternity: 'maternity' };

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leaveType: { type: String, enum: LEAVE_TYPES, required: true },
    duration: { type: String, enum: ['full', 'first_half', 'second_half'], default: 'full' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    numDays: { type: Number, required: true, min: 0.5 },
    contactNumber: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    reason: { type: String, trim: true, required: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
    balanceDeducted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
leaveSchema.index({ employee: 1, startDate: -1 });
jsonPlugin(leaveSchema);

export const Leave = mongoose.models.Leave || mongoose.model('Leave', leaveSchema);
