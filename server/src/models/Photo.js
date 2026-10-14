import mongoose from 'mongoose';

/** A stored rendition of the photo in GridFS. */
const fileRef = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const photoSchema = new mongoose.Schema(
  {
    album: { type: mongoose.Schema.Types.ObjectId, ref: 'Album', required: true, index: true },
    caption: { type: String, trim: true, default: '', maxlength: 300 },
    originalName: { type: String, trim: true, default: '', maxlength: 255 },
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 },
    /** The file exactly as uploaded — what "Download" returns. */
    original: { type: fileRef, required: true },
    /** Screen-sized (~1600px) rendition for the lightbox. Falls back to the original when absent. */
    preview: { type: fileRef, default: null },
    /** Grid-sized (~480px) rendition. Falls back to preview, then original. */
    thumb: { type: fileRef, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    downloadCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

photoSchema.index({ album: 1, createdAt: -1 });
photoSchema.index({ createdAt: -1 });

photoSchema.methods.fileIds = function fileIds() {
  return [this.original?.fileId, this.preview?.fileId, this.thumb?.fileId].filter(Boolean);
};

/** Storage details never leave the server; the controller adds signed `urls` instead. */
photoSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    ret.mimeType = ret.original?.mimeType;
    ret.size = ret.original?.size;
    delete ret.original;
    delete ret.preview;
    delete ret.thumb;
    return ret;
  },
});

export const Photo = mongoose.models.Photo || mongoose.model('Photo', photoSchema);
