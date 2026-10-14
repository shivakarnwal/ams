import mongoose from 'mongoose';

const salarySlipSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: 'application/pdf' },
    size: { type: Number, required: true, min: 1 },
    /** SHA-256 of the plaintext PDF (integrity / duplicate detection) */
    checksum: { type: String, required: true },
    note: { type: String, trim: true, default: '', maxlength: 300 },

    // Encrypted file payload — never selected by default, never serialised.
    data: { type: Buffer, required: true, select: false },
    iv: { type: Buffer, required: true, select: false },
    authTag: { type: Buffer, required: true, select: false },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    replacedAt: Date,
    downloadCount: { type: Number, default: 0 },
    lastDownloadedAt: Date,
  },
  { timestamps: true },
);

salarySlipSchema.index({ employee: 1, year: 1, month: 1 }, { unique: true });
salarySlipSchema.index({ year: -1, month: -1 });

salarySlipSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.data;
    delete ret.iv;
    delete ret.authTag;
    return ret;
  },
});

export const SalarySlip = mongoose.models.SalarySlip || mongoose.model('SalarySlip', salarySlipSchema);
