import fs from 'node:fs';
import path from 'node:path';
import { SEED_DIR } from './config.js';
import { Template } from './models/Template.js';
import { analyzeTemplate, PROFILE_VERSION } from './services/templateAnalyzer.js';

// Formats saved by an older version get the newer settings (marks rule, answer
// blanks) filled in from their file. Settings the user changed are kept as they are.
export async function upgradeTemplates() {
  const outdated = await Template.find({
    $or: [{ 'profile.version': { $lt: PROFILE_VERSION } }, { 'profile.version': { $exists: false } }],
  }).select('+file');
  for (const t of outdated) {
    try {
      const { profile } = await analyzeTemplate(t.file, { allowLlm: false });
      t.profile = {
        ...t.profile,
        version: PROFILE_VERSION,
        answerLines: t.profile.answerLines ?? true,
        marks: {
          ...t.profile.marks,
          whenMissing: t.profile.marks?.whenMissing ?? profile.marks.whenMissing,
          defaultValue: t.profile.marks?.defaultValue ?? profile.marks.defaultValue,
        },
      };
      t.markModified('profile');
      await t.save();
      console.log(`[upgrade] format "${t.name}" updated to version ${PROFILE_VERSION}`);
    } catch (err) {
      console.warn(`[upgrade] skipped "${t.name}": ${err.message}`);
    }
  }
}

// On first start (no formats in the database) the .xlsx files in server/seed
// are added as ready-to-use formats. The upsert on a unique seedKey keeps two
// servers starting at the same moment (e.g. node --watch restarts) from both adding them.
export async function seedTemplates() {
  if (process.env.SEED_SAMPLE_TEMPLATES === 'false') return;
  await Template.init(); // make sure the unique index exists before upserting
  if (await Template.estimatedDocumentCount()) return;
  if (!fs.existsSync(SEED_DIR)) return;

  const files = fs.readdirSync(SEED_DIR).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  for (const file of files) {
    try {
      const buffer = fs.readFileSync(path.join(SEED_DIR, file));
      const { profile, method, warnings } = await analyzeTemplate(buffer);
      const result = await Template.updateOne(
        { seedKey: `seed:${file.toLowerCase()}` },
        {
          $setOnInsert: {
            name: file.replace(/\.xlsx$/i, ''),
            description: 'Sample format: school header, subject sections, bold Q-headings with marks on the right.',
            originalFileName: file,
            file: buffer,
            profile,
            analysis: { method, warnings, analyzedAt: new Date() },
            isSample: true,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount) console.log(`[seed] added sample format "${file}"`);
    } catch (err) {
      if (err.code === 11000) continue; // another server instance added it at the same moment
      console.warn(`[seed] skipped ${file}: ${err.message}`);
    }
  }
}
