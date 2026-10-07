import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { config, groqEnabled } from './config.js';
import { connectDb, explainDbError } from './db.js';
import papersRouter from './routes/papers.js';
import templatesRouter from './routes/templates.js';
import { seedTemplates, upgradeTemplates } from './seed.js';
import { failInterruptedPapers } from './services/paperProcessor.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1,
    groq: groqEnabled(),
    visionModel: config.groq.visionModel,
    textModel: config.groq.textModel,
    ocrFallback: config.ocrFallback,
    maxImages: config.maxImages,
    maxImageMb: config.maxImageMb,
  });
});

app.use('/api/templates', templatesRouter);
app.use('/api/papers', papersRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Optional single-server deployment: set CLIENT_DIST_DIR=../client/dist after building the client.
if (config.clientDist && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
  app.use(express.static(config.clientDist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

app.get('/', (req, res) => {
  res.type('text').send('PaperSheet API is running. Open the client app (http://localhost:5173 in development).');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  if (err instanceof multer.MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = `A file is too large. Images can be up to ${config.maxImageMb} MB and Excel files up to ${config.maxTemplateMb} MB.`;
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = `You can upload up to ${config.maxImages} images at a time.`;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'The request is too large.';
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

async function main() {
  await connectDb(config.mongoUri);
  await failInterruptedPapers();
  await seedTemplates();
  await upgradeTemplates();
  app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}`);
    console.log(
      groqEnabled()
        ? `[server] Groq on (vision: ${config.groq.visionModel}, text: ${config.groq.textModel})`
        : '[server] GROQ_API_KEY not set - using Tesseract OCR + built-in rules (printed text only)',
    );
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  const hint = explainDbError(err);
  if (hint) console.error(`[server] hint: ${hint}`);
  process.exit(1);
});
