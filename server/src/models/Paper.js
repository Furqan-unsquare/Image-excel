import mongoose from 'mongoose';

const { Schema } = mongoose;

// One conversion: question images -> structured content -> Excel file.
const PaperSchema = new Schema(
  {
    title: { type: String, default: 'Question paper', trim: true },
    template: { type: Schema.Types.ObjectId, ref: 'Template', required: true },
    templateName: { type: String, default: '' },

    status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing', index: true },
    progress: {
      stage: { type: String, default: 'queued' }, // queued | prepare | ocr | structure | excel | done
      message: { type: String, default: 'Waiting to start' },
      percent: { type: Number, default: 0 },
    },
    error: { type: String, default: '' },
    warnings: { type: [String], default: [] },

    images: [{ name: String, size: Number, mimetype: String, width: Number, height: Number }],
    options: {
      includeAnswers: { type: Boolean, default: false },
    },

    ocr: {
      method: { type: String, default: '' }, // groq-vision | tesseract | mixed
      text: { type: String, default: '' },
    },
    structureMethod: { type: String, default: '' }, // groq | rules
    // { meta, header: [{address, text}], sections: [{ title, questions: [...] }] }
    content: { type: Schema.Types.Mixed, default: null },

    output: {
      file: { type: Buffer, select: false },
      fileName: { type: String, default: '' },
      generatedAt: Date,
    },
  },
  { timestamps: true, minimize: false },
);

export const Paper = mongoose.model('Paper', PaperSchema);
