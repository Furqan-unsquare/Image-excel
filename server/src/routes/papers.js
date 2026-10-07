import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { Paper } from '../models/Paper.js';
import { PaperImage } from '../models/PaperImage.js';
import { Template } from '../models/Template.js';
import { normalizeImage } from '../services/ocr.js';
import { normalizeContent } from '../services/paperParser.js';
import { generateOutput, startProcessing } from '../services/paperProcessor.js';
import { renderBuffer } from '../services/sheetRender.js';
import { httpError, isObjectId } from '../utils/http.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageMb * 1024 * 1024, files: config.maxImages },
  fileFilter(req, file, cb) {
    if (/\.(heic|heif)$/i.test(file.originalname) || /heic|heif/i.test(file.mimetype)) {
      return cb(httpError(400, 'HEIC photos are not supported. Please upload JPG or PNG (most phones can share as JPG).'));
    }
    return file.mimetype.startsWith('image/') ? cb(null, true) : cb(httpError(400, `"${file.originalname}" is not an image.`));
  },
});

const paperDto = (p, { full = false } = {}) => ({
  id: String(p._id),
  title: p.title,
  templateId: p.template ? String(p.template) : null,
  templateName: p.templateName,
  status: p.status,
  progress: p.progress,
  error: p.error,
  warnings: p.warnings,
  images: (p.images || []).map((img, index) => ({ index, name: img.name, width: img.width, height: img.height })),
  options: p.options,
  fileName: p.output?.fileName || '',
  generatedAt: p.output?.generatedAt || null,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  ...(full
    ? {
        content: p.content,
        ocr: { method: p.ocr?.method || '', text: p.ocr?.text || '' },
        structureMethod: p.structureMethod,
      }
    : {}),
});

router.param('id', (req, res, next, id) => (isObjectId(id) ? next() : next(httpError(404, 'Paper not found'))));

async function findPaper(id, withFile = false) {
  const query = Paper.findById(id);
  if (withFile) query.select('+output.file');
  const p = await query;
  if (!p) throw httpError(404, 'Paper not found');
  return p;
}

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const list = await Paper.find().sort({ createdAt: -1 }).limit(limit).select('-content -ocr');
  res.json(list.map((p) => paperDto(p)));
});

router.post('/', upload.array('images', config.maxImages), async (req, res) => {
  const templateId = req.body?.templateId;
  if (!isObjectId(templateId)) throw httpError(400, 'Select a format first.');
  const template = await Template.findById(templateId);
  if (!template) throw httpError(404, 'The selected format no longer exists.');
  const files = req.files || [];
  if (!files.length) throw httpError(400, 'Add at least one image of the questions.');

  const prepared = [];
  for (const file of files) prepared.push({ file, image: await normalizeImage(file.buffer) });

  const paper = await Paper.create({
    title: String(req.body?.title || '').trim() || 'Question paper',
    template: template._id,
    templateName: template.name,
    status: 'processing',
    progress: { stage: 'queued', message: 'Queued', percent: 2 },
    images: prepared.map(({ file, image }) => ({
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      width: image.width,
      height: image.height,
    })),
    options: { includeAnswers: String(req.body?.includeAnswers) === 'true' },
  });
  await PaperImage.insertMany(
    prepared.map(({ file, image }, index) => ({
      paper: paper._id,
      index,
      name: file.originalname,
      mimetype: image.mimetype,
      data: image.buffer,
    })),
  );

  startProcessing(paper._id);
  res.status(201).json(paperDto(paper, { full: true }));
});

router.get('/:id', async (req, res) => {
  res.json(paperDto(await findPaper(req.params.id), { full: true }));
});

router.get('/:id/preview', async (req, res) => {
  const p = await findPaper(req.params.id, true);
  if (!p.output?.file) throw httpError(409, 'This paper has no Excel file yet.');
  res.json(await renderBuffer(p.output.file));
});

router.get('/:id/download', async (req, res) => {
  const p = await findPaper(req.params.id, true);
  if (!p.output?.file) throw httpError(409, 'This paper has no Excel file yet.');
  res.attachment(p.output.fileName || 'question-paper.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(p.output.file);
});

router.get('/:id/images/:index', async (req, res) => {
  const img = await PaperImage.findOne({ paper: req.params.id, index: Number(req.params.index) || 0 });
  if (!img) throw httpError(404, 'Image not found');
  res.type(img.mimetype || 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(img.data);
});

// Save edited questions / header and rebuild the Excel file.
router.put('/:id/content', async (req, res) => {
  const p = await findPaper(req.params.id, true);
  if (p.status === 'processing') throw httpError(409, 'This paper is still being processed.');
  const { content, includeAnswers, title } = req.body || {};
  if (!content || typeof content !== 'object') throw httpError(400, 'Missing content.');

  const template = await Template.findById(p.template).select('+file');
  if (!template) throw httpError(409, 'The format used for this paper was deleted. Start a new paper with another format.');

  p.content = normalizeContent(content);
  if (typeof includeAnswers === 'boolean') p.options.includeAnswers = includeAnswers;
  if (typeof title === 'string' && title.trim()) p.title = title.trim().slice(0, 120);
  await generateOutput(p, template);
  p.status = 'done';
  p.error = '';
  await p.save();
  res.json(paperDto(p, { full: true }));
});

// Run OCR + structuring again from the stored images (e.g. after adding GROQ_API_KEY).
router.post('/:id/retry', async (req, res) => {
  const p = await findPaper(req.params.id);
  if (p.status === 'processing') throw httpError(409, 'This paper is already being processed.');
  if (!(await PaperImage.exists({ paper: p._id }))) throw httpError(409, 'The original images are no longer available.');
  if (isObjectId(req.body?.templateId)) {
    const t = await Template.findById(req.body.templateId);
    if (!t) throw httpError(404, 'Format not found');
    p.template = t._id;
    p.templateName = t.name;
  }
  p.status = 'processing';
  p.error = '';
  p.progress = { stage: 'queued', message: 'Queued', percent: 2 };
  await p.save();
  startProcessing(p._id);
  res.json(paperDto(p, { full: true }));
});

router.delete('/:id', async (req, res) => {
  const p = await findPaper(req.params.id);
  await PaperImage.deleteMany({ paper: p._id });
  await p.deleteOne();
  res.json({ ok: true });
});

export default router;
