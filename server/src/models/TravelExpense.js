import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const travelExpenseSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expenseNo: { type: String, unique: true },
    purpose: { type: String, required: true, trim: true, maxlength: 300 },
    fromLocation: { type: String, required: true, trim: true },
    toLocation: { type: String, required: true, trim: true },
    travelDate: { type: Date, required: true },
    mode: { type: String, enum: ['bus', 'train', 'flight', 'taxi', 'own_vehicle', 'other'], default: 'other' },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    remarks: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);
travelExpenseSchema.index({ travelDate: -1 });
jsonPlugin(travelExpenseSchema);

export const TravelExpense = mongoose.models.TravelExpense || mongoose.model('TravelExpense', travelExpenseSchema);
