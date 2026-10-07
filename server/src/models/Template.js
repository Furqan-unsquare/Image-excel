import mongoose from 'mongoose';

const { Schema } = mongoose;

// An uploaded Excel "format". The original file is kept so generated papers
// reuse its header, fonts, column widths and print settings exactly.
const TemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    originalFileName: { type: String, default: '' },
    file: { type: Buffer, required: true, select: false },
    // Detected layout rules (see services/templateAnalyzer.js). Editable from the UI.
    profile: { type: Schema.Types.Mixed, required: true },
    analysis: {
      method: { type: String, enum: ['heuristic', 'llm'], default: 'heuristic' },
      warnings: { type: [String], default: [] },
      analyzedAt: { type: Date, default: Date.now },
    },
    isSample: { type: Boolean, default: false },
    // Set only for formats added from server/seed, so seeding can never create duplicates.
    seedKey: { type: String, unique: true, sparse: true },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

export const Template = mongoose.model('Template', TemplateSchema);
