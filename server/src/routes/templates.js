import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { Template } from '../models/Template.js';
import { analyzeTemplate, mergeProfileSettings } from '../services/templateAnalyzer.js';
import { buildPaperWorkbook } from '../services/excelGenerator.js';
import { renderBuffer, renderWorksheet } from '../services/sheetRender.js';
import { normalizeContent, buildHeaderLines } from '../services/paperParser.js';
import { SAMPLE_CONTENT } from '../services/sampleContent.js';
import { httpError, isObjectId } from '../utils/http.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxTemplateMb * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (/\.xls$/i.test(file.originalname)) {
      return cb(httpError(400, 'Old .xls files are not supported. Open the file in Excel and use "Save As" → .xlsx.'));
    }
    const ok =
      /\.xlsx$/i.test(file.originalname) ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return ok ? cb(null, true) : cb(httpError(400, 'Please upload an Excel (.xlsx) file.'));
  },
});

export const templateDto = (t) => ({
  id: String(t._id),
  name: t.name,
  description: t.description,
  originalFileName: t.originalFileName,
  profile: t.profile,
  analysis: t.analysis,
  isSample: t.isSample,
  usageCount: t.usageCount,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

router.param('id', (req, res, next, id) => (isObjectId(id) ? next() : next(httpError(404, 'Format not found'))));

async function findTemplate(id, withFile = false) {
  const query = Template.findById(id);
  if (withFile) query.select('+file');
  const t = await query;
  if (!t) throw httpError(404, 'Format not found');
  return t;
}

router.get('/', async (req, res) => {
  const list = await Template.find().sort({ updatedAt: -1 });
  res.json(list.map(templateDto));
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose an Excel (.xlsx) file to upload.');
  const { profile, method, warnings } = await analyzeTemplate(req.file.buffer, {
    forceLlm: String(req.body?.useAi) === 'true',
  });
  const name = String(req.body?.name || '').trim() || req.file.originalname.replace(/\.xlsx$/i, '');
  const t = await Template.create({
    name,
    description: String(req.body?.description || '').trim(),
    originalFileName: req.file.originalname,
    file: req.file.buffer,
    profile,
    analysis: { method, warnings, analyzedAt: new Date() },
  });
  res.status(201).json(templateDto(t));
});

router.get('/:id', async (req, res) => {
  res.json(templateDto(await findTemplate(req.params.id)));
});

// The uploaded file exactly as it is.
router.get('/:id/preview', async (req, res) => {
  const t = await findTemplate(req.params.id, true);
  res.json(await renderBuffer(t.file, t.profile.sheetName));
});

// Demo questions written in this format, so changes to the settings can be seen.
router.get('/:id/sample-preview', async (req, res) => {
  const t = await findTemplate(req.params.id, true);
  const content = normalizeContent(SAMPLE_CONTENT);
  content.header = buildHeaderLines(t.profile, content);
  const { worksheet } = await buildPaperWorkbook({ templateBuffer: t.file, profile: t.profile, content });
  res.json(renderWorksheet(worksheet));
});

router.get('/:id/file', async (req, res) => {
  const t = await findTemplate(req.params.id, true);
  res.attachment(t.originalFileName || `${t.name}.xlsx`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(t.file);
});

router.patch('/:id', async (req, res) => {
  const t = await findTemplate(req.params.id);
  const { name, description, settings } = req.body || {};
  if (typeof name === 'string' && name.trim()) t.name = name.trim().slice(0, 120);
  if (typeof description === 'string') t.description = description.trim().slice(0, 500);
  if (settings && typeof settings === 'object') {
    t.profile = mergeProfileSettings(t.profile, settings);
    t.markModified('profile');
  }
  await t.save();
  res.json(templateDto(t));
});

router.post('/:id/reanalyze', async (req, res) => {
  const t = await findTemplate(req.params.id, true);
  const { profile, method, warnings } = await analyzeTemplate(t.file, { forceLlm: Boolean(req.body?.useAi) });
  t.profile = profile;
  t.analysis = { method, warnings, analyzedAt: new Date() };
  t.markModified('profile');
  await t.save();
  res.json(templateDto(t));
});

router.delete('/:id', async (req, res) => {
  const t = await findTemplate(req.params.id);
  await t.deleteOne();
  res.json({ ok: true });
});

export default router;
