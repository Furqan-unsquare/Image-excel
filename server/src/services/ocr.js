// Image preparation + text extraction (OCR).
// 1. Images are auto-rotated, flattened and resized once (that copy is stored).
// 2. Very tall images (stitched screenshots, long scans) are cut into page-sized
//    pieces at blank rows, so the vision model sees text at a readable size.
// 3. Each piece is read by the Groq vision model; Tesseract is the fallback.
import fs from 'node:fs';
import sharp from 'sharp';
import { config, groqEnabled } from '../config.js';
import { groqText } from './groq.js';

const STORE_MAX_WIDTH = 1600;

export async function normalizeImage(buffer) {
  try {
    const { data, info } = await sharp(buffer, { failOn: 'none', limitInputPixels: 150_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: STORE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, mimetype: 'image/jpeg' };
  } catch {
    const err = new Error('One of the files is not a readable image. Please upload JPG, PNG or WebP photos.');
    err.status = 400;
    throw err;
  }
}

// Returns the y positions where a tall image should be cut.
async function findCuts(buffer, width, height) {
  const target = Math.round(width * 1.3);
  if (height <= width * 1.6) return [];

  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const w = info.width;
  const h = info.height;

  // "Ink" per row: mean absolute deviation of pixel brightness. Blank paper,
  // ruled lines and dark separators score low; lines of text score high.
  const score = new Float64Array(h);
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    let n = 0;
    const rowStart = y * w * channels;
    for (let x = 0; x < w; x += 2) {
      sum += data[rowStart + x * channels];
      n += 1;
    }
    const mean = sum / n;
    let dev = 0;
    for (let x = 0; x < w; x += 2) dev += Math.abs(data[rowStart + x * channels] - mean);
    score[y] = dev / n;
  }
  const smooth = new Float64Array(h);
  const R = 4;
  for (let y = 0; y < h; y += 1) {
    let s = 0;
    for (let k = -R; k <= R; k += 1) s += score[Math.min(h - 1, Math.max(0, y + k))];
    smooth[y] = s / (2 * R + 1);
  }

  const cuts = [];
  let start = 0;
  while (h - start > target * 1.25) {
    const ideal = start + target;
    const lo = start + Math.round(target * 0.6);
    const hi = Math.min(h - 1, ideal + Math.round(target * 0.25));
    let best = ideal;
    let bestScore = Infinity;
    for (let y = lo; y <= hi; y += 1) {
      const s = smooth[y] + (Math.abs(y - ideal) / target) * 2;
      if (s < bestScore) {
        bestScore = s;
        best = y;
      }
    }
    cuts.push(best);
    start = best;
  }
  return cuts;
}

export async function sliceForOcr(buffer, width, height) {
  const cuts = await findCuts(buffer, width, height);
  if (!cuts.length) return [buffer];
  const bounds = [0, ...cuts, height];
  const pieces = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const top = bounds[i];
    const pieceHeight = bounds[i + 1] - top;
    if (pieceHeight < 20) continue;
    pieces.push(
      await sharp(buffer).extract({ left: 0, top, width, height: pieceHeight }).jpeg({ quality: 90 }).toBuffer(),
    );
  }
  return pieces;
}

// Groq's vision model receives a picture as several overlapping tiles and, unless
// told otherwise, transcribes each tile separately (duplicated, cut-off lines).
const VISION_PROMPT = `This is ONE photo or screenshot of a page from a school question paper or notebook. You may receive it as several overlapping tiles: treat them as one single page.
Transcribe the page once, from top to bottom, line by line, exactly as written.
- Never repeat a line and never output partial or cut-off copies of lines. Do not write labels like [Image 1].
- Keep the original numbering and labels (Q1., Que 2, (Q4), 1., 2], A., (a), Ans] ...) and the original line breaks.
- Keep fill-in blanks as underscores (______). A blank can also look like a thin horizontal line after or inside a sentence (where students write the answer): write it as ______ too.
- Keep brackets, slashes and punctuation.
- Tables or grids: write each row on its own line with the cells separated by " | " (e.g. "Material | Written | Oral"); leave empty cells empty.
- For handwriting, give your best reading of every word.
- If there is a diagram or picture, write [Picture: short description] on its own line where it appears.
- Skip things that are not paper content: phone status bars, app buttons, "Page No" / "Date" boxes, watermarks.
- Do not answer, explain, translate or summarise anything. Output only the transcribed text.`;

// Vision tokens grow with image area and the Groq free tier allows only ~7000 image
// tokens per minute, so pieces are sent at a width that is still easy to read.
const OCR_MAX_WIDTH = 1100;

async function visionOcr(jpeg, onWait) {
  const meta = await sharp(jpeg).metadata();
  const sized =
    (meta.width || 0) > OCR_MAX_WIDTH
      ? await sharp(jpeg).resize({ width: OCR_MAX_WIDTH }).jpeg({ quality: 88 }).toBuffer()
      : jpeg;
  const dataUrl = `data:image/jpeg;base64,${sized.toString('base64')}`;
  const text = await groqText({
    model: config.groq.visionModel,
    reasoningEffort: 'none',
    maxTokens: 4096,
    onWait,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return dropRepeatedTiles(text);
}

// Even when told not to, the vision model sometimes transcribes the page and then
// starts again with cut-off copies of the same lines (one per internal tile).
// Detect that restart - the first line comes back as a fragment and is followed by
// more fragments of earlier lines - and keep only the first, complete transcription.
export function dropRepeatedTiles(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\[Image \d+\]\s*$/i.test(l));
  const flat = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const content = lines.map((l, i) => ({ i, f: flat(l) })).filter((x) => x.f);
  if (content.length < 6) return lines.join('\n').trim();
  const first = content[0].f;
  for (let k = 1; k < content.length; k += 1) {
    const cur = content[k].f;
    if (cur.length < 5 || !first.startsWith(cur)) continue;
    const earlier = content.slice(0, k).map((x) => x.f);
    const next = content.slice(k + 1, k + 6);
    const fragments = next.filter((x) => earlier.some((e) => e.includes(x.f))).length;
    if (next.length && fragments >= Math.min(3, next.length)) return lines.slice(0, content[k].i).join('\n').trim();
  }
  return lines.join('\n').trim();
}

class TesseractReader {
  async read(jpeg) {
    if (!this.worker) {
      const { createWorker } = await import('tesseract.js');
      fs.mkdirSync(config.tesseractCache, { recursive: true });
      this.worker = await createWorker('eng', 1, { cachePath: config.tesseractCache });
      await this.worker.setParameters({ preserve_interword_spaces: '1' });
    }
    const meta = await sharp(jpeg).metadata();
    const prepared = await sharp(jpeg)
      .greyscale()
      .normalize()
      .resize({ width: Math.max(meta.width || 0, 1800), withoutEnlargement: false })
      .png()
      .toBuffer();
    const { data } = await this.worker.recognize(prepared);
    return data.text || '';
  }

  async close() {
    if (this.worker) await this.worker.terminate().catch(() => {});
    this.worker = null;
  }
}

/**
 * Reads every image (in order) and returns the combined text.
 * @param {{buffer: Buffer, width: number, height: number}[]} images normalized images
 * @param {(done: number, total: number) => Promise<void>|void} onProgress
 * @param {(seconds: number) => Promise<void>|void} onWait called while waiting out a Groq rate limit
 */
export async function extractText(images, onProgress = () => {}, onWait = () => {}) {
  const useGroq = groqEnabled();
  const allowTesseract = config.ocrFallback === 'tesseract';
  if (!useGroq && !allowTesseract) {
    throw new Error('No OCR engine available. Set GROQ_API_KEY (recommended) or OCR_FALLBACK=tesseract.');
  }

  const pages = [];
  for (const img of images) pages.push(await sliceForOcr(img.buffer, img.width, img.height));
  const total = pages.reduce((n, p) => n + p.length, 0);

  const tesseract = new TesseractReader();
  const methods = new Set();
  const warnings = [];
  const pageTexts = [];
  let done = 0;
  try {
    for (const pieces of pages) {
      const texts = [];
      for (const piece of pieces) {
        let text = null;
        if (useGroq) {
          try {
            text = await visionOcr(piece, onWait);
            methods.add('groq-vision');
          } catch (err) {
            if (!allowTesseract) throw err;
            warnings.push(`AI reading failed for one part (${err.message}); used basic OCR instead, so check that part.`);
          }
        }
        if (text === null) {
          text = await tesseract.read(piece);
          methods.add('tesseract');
        }
        texts.push(text.trim());
        done += 1;
        await onProgress(done, total);
      }
      pageTexts.push(texts.filter(Boolean).join('\n'));
    }
  } finally {
    await tesseract.close();
  }

  if (!useGroq) warnings.push('GROQ_API_KEY is not set: used basic OCR (Tesseract). Handwriting will not be read well.');
  const method = methods.size > 1 ? 'mixed' : [...methods][0] || 'none';
  return { text: pageTexts.join('\n\n'), method, warnings };
}
