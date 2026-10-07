// Runs a conversion in the background and records progress on the Paper
// document so the UI can poll it: images -> OCR text -> questions -> Excel.
import { Paper } from '../models/Paper.js';
import { PaperImage } from '../models/PaperImage.js';
import { Template } from '../models/Template.js';
import { buildPaperWorkbook } from './excelGenerator.js';
import { extractText } from './ocr.js';
import { applyMissingMarks, buildHeaderLines, normalizeContent, paperTitle, structureText } from './paperParser.js';
import { safeFileName } from '../utils/http.js';
import sharp from 'sharp';

const running = new Set();

async function setProgress(id, stage, message, percent) {
  await Paper.updateOne({ _id: id }, { $set: { progress: { stage, message, percent } } });
}

// Builds the .xlsx for a paper's current content and stores it on the paper.
export async function generateOutput(paper, template) {
  const tpl = template.file ? template : await Template.findById(template._id || template).select('+file');
  if (!tpl) throw new Error('The selected format no longer exists. Pick another format.');
  const content = normalizeContent(paper.content);
  if (!content.header) content.header = buildHeaderLines(tpl.profile, content);

  const { buffer } = await buildPaperWorkbook({
    templateBuffer: tpl.file,
    profile: tpl.profile,
    content,
    includeAnswers: Boolean(paper.options?.includeAnswers),
  });

  const title = paper.title || paperTitle(content);
  paper.content = content;
  paper.output = { file: buffer, fileName: `${safeFileName(title)}.xlsx`, generatedAt: new Date() };
  paper.markModified('content');
  return buffer;
}

export async function processPaper(paperId) {
  const key = String(paperId);
  if (running.has(key)) return;
  running.add(key);
  try {
    const paper = await Paper.findById(paperId);
    if (!paper) return;
    const template = await Template.findById(paper.template).select('+file');
    if (!template) throw new Error('The selected format no longer exists. Pick another format.');

    await setProgress(paperId, 'prepare', 'Preparing images', 5);
    const stored = await PaperImage.find({ paper: paperId }).sort({ index: 1 });
    if (!stored.length) throw new Error('No images were found for this paper.');
    const images = [];
    for (const img of stored) {
      const meta = await sharp(img.data).metadata();
      images.push({ buffer: img.data, width: meta.width, height: meta.height });
    }

    await setProgress(paperId, 'ocr', 'Reading text from images', 10);
    let ocrDone = 0;
    let ocrTotal = 1;
    const ocrPercent = () => 10 + Math.round((ocrDone / ocrTotal) * 50);
    const ocr = await extractText(
      images,
      (done, total) => {
        ocrDone = done;
        ocrTotal = total;
        return setProgress(paperId, 'ocr', `Reading text (${done}/${total})`, ocrPercent());
      },
      (seconds) =>
        setProgress(paperId, 'ocr', `Groq free-tier limit reached – waiting ${seconds}s, then continuing`, ocrPercent()),
    );
    if (!ocr.text.trim()) throw new Error('No text could be read from the images. Try clearer, well-lit photos.');

    await setProgress(paperId, 'structure', 'Finding questions, sub-questions and marks', 65);
    const structured = await structureText(ocr.text, {
      onWait: (seconds) =>
        setProgress(paperId, 'structure', `Groq free-tier limit reached – waiting ${seconds}s, then continuing`, 65),
    });
    const content = structured.content;
    const marksNote = applyMissingMarks(content, template.profile);
    content.header = buildHeaderLines(template.profile, content);

    await setProgress(paperId, 'excel', 'Building the Excel file', 90);
    paper.ocr = { method: ocr.method, text: ocr.text };
    paper.structureMethod = structured.method;
    paper.content = content;
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const keepTitle = paper.title && paper.title !== 'Question paper' && !paper.title.startsWith('Question paper ');
    if (!keepTitle) paper.title = paperTitle(content, `Question paper ${today}`);
    paper.warnings = [...ocr.warnings, ...structured.warnings, ...(marksNote ? [marksNote] : [])];
    await generateOutput(paper, template);

    const questionCount = content.sections.reduce((n, s) => n + s.questions.length, 0);
    if (!questionCount) paper.warnings.push('No questions were recognised. Use "Edit content" to add them, or try a clearer photo.');

    paper.status = 'done';
    paper.error = '';
    paper.progress = { stage: 'done', message: 'Ready', percent: 100 };
    await paper.save();
    await Template.updateOne({ _id: template._id }, { $inc: { usageCount: 1 } });
  } catch (err) {
    console.error(`[paper ${key}]`, err);
    await Paper.updateOne(
      { _id: paperId },
      {
        $set: {
          status: 'failed',
          error: err.message || 'Something went wrong',
          progress: { stage: 'failed', message: 'Failed', percent: 100 },
        },
      },
    );
  } finally {
    running.delete(key);
  }
}

export function startProcessing(paperId) {
  setImmediate(() => {
    processPaper(paperId).catch((err) => console.error('[processPaper]', err));
  });
}

// Papers left "processing" by a crash/restart would spin forever in the UI.
export async function failInterruptedPapers() {
  const res = await Paper.updateMany(
    { status: 'processing' },
    {
      $set: {
        status: 'failed',
        error: 'The server restarted while this paper was being processed. Click "Run again".',
        progress: { stage: 'failed', message: 'Interrupted', percent: 100 },
      },
    },
  );
  if (res.modifiedCount) console.log(`[papers] marked ${res.modifiedCount} interrupted paper(s) as failed`);
}
