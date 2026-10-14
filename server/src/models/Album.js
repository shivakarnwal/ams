import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const albumSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Album name is required'], trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    /** Date of the event the photos are from (shown on the album card). Defaults to the creation date. */
    eventDate: { type: Date, default: () => new Date() },
    /** Explicit cover; when empty the newest photo in the album is used. */
    coverPhoto: { type: mongoose.Schema.Types.ObjectId, ref: 'Photo', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

albumSchema.index({ eventDate: -1, createdAt: -1 });
albumSchema.index({ name: 1 });
jsonPlugin(albumSchema);

export const Album = mongoose.models.Album || mongoose.model('Album', albumSchema);
