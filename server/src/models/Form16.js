import mongoose from 'mongoose';
import { fyLabel, values, FORM16_PARTS } from './employeeDocOptions.js';
import { auditFields, encryptedFileFields, secureToJSON } from './encryptedFile.js';

/** Form 16 certificate. Part A and Part B are separate records: one of each per employee and financial year. */
const form16Schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    part: { type: String, enum: values(FORM16_PARTS), required: true },
    /** Starting calendar year of the financial year (2025 = FY 2025-26, AY 2026-27) */
    fyStart: { type: Number, required: true, min: 2000, max: 2100 },
    certificateNo: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
    employerTan: { type: String, trim: true, uppercase: true, default: '', maxlength: 10 },
    issueDate: Date,
    remarks: { type: String, trim: true, default: '', maxlength: 500 },
    ...encryptedFileFields,
    ...auditFields,
  },
  { timestamps: true },
);

form16Schema.virtual('financialYear').get(function fy() { return fyLabel(this.fyStart); });
form16Schema.virtual('assessmentYear').get(function ay() { return fyLabel(this.fyStart + 1); });

form16Schema.index({ employee: 1, fyStart: 1, part: 1 }, { unique: true });
form16Schema.index({ part: 1, fyStart: -1, createdAt: -1 });
secureToJSON(form16Schema);

export const Form16 = mongoose.models.Form16 || mongoose.model('Form16', form16Schema);
