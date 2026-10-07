import mongoose from 'mongoose';

const { Schema } = mongoose;

// Source images are stored separately from Paper so a paper with many photos
// never hits MongoDB's 16 MB document limit, and so "Run again" can re-read them.
const PaperImageSchema = new Schema(
  {
    paper: { type: Schema.Types.ObjectId, ref: 'Paper', required: true, index: true },
    index: { type: Number, required: true },
    name: { type: String, default: '' },
    mimetype: { type: String, default: 'image/jpeg' },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

PaperImageSchema.index({ paper: 1, index: 1 }, { unique: true });

export const PaperImage = mongoose.model('PaperImage', PaperImageSchema);
