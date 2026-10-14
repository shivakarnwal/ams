import mongoose from 'mongoose';
import { APPRAISAL_RATINGS, APPRAISAL_TYPES, values } from './employeeDocOptions.js';
import { auditFields, encryptedFileFields, secureToJSON } from './encryptedFile.js';

/** Performance Appraisal Letter (PAL): one letter per employee, period (year + month) and appraisal type. */
const appraisalLetterSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    appraisalType: { type: String, enum: values(APPRAISAL_TYPES), default: 'annual' },
    /** Appraisal period the letter belongs to — used by the Yearly / Monthly filters */
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    effectiveDate: Date,
    rating: { type: String, enum: [...values(APPRAISAL_RATINGS), ''], default: '' },
    remarks: { type: String, trim: true, default: '', maxlength: 500 },
    ...encryptedFileFields,
    ...auditFields,
  },
  { timestamps: true },
);

appraisalLetterSchema.index({ employee: 1, year: 1, month: 1, appraisalType: 1 }, { unique: true });
appraisalLetterSchema.index({ year: -1, month: -1, createdAt: -1 });
secureToJSON(appraisalLetterSchema);

export const AppraisalLetter = mongoose.models.AppraisalLetter || mongoose.model('AppraisalLetter', appraisalLetterSchema);
