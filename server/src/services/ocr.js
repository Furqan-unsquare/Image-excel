// Image preparation + text extraction (OCR).
// 1. Images are auto-rotated, flattened and resized once (that copy is stored).
// 2. Very tall images (stitched screenshots, long scans) are cut into page-sized
//    pieces at blank rows, so the vision model sees text at a readable size.
// 3. Each piece is read by the Groq vision model; Tesseract is the fallback.
//    Hindi/Marathi printed pages are read by Tesseract first and its draft guides
//    the vision model, which otherwise "improves" Devanagari words into other words.
import fs from 'node:fs';
import sharp from 'sharp';
import { config, groqEnabled } from '../config.js';
import { groqText } from './groq.js';
import { LANGUAGE_NAMES } from '../utils/lang.js';

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
const INTRO =
  'This is ONE photo or screenshot of a page from a school question paper or notebook. You may receive it as several overlapping tiles: treat them as one single page.';

const BASE_RULES = `Transcribe the page once, from top to bottom, line by line, exactly as written.
- Never repeat a line and never output partial or cut-off copies of lines. Do not write labels like [Image 1].
- Keep the original numbering and labels (Q1., Que 2, (Q4), 1., 2], A., (a), Ans] ...) and the original line breaks.
- Keep fill-in blanks as underscores (______). A blank can also look like a thin horizontal line after or inside a sentence (where students write the answer): write it as ______ too.
- Keep brackets, slashes and punctuation.
- Tables or grids: write each row on its own line with the cells separated by " | " (e.g. "Material | Written | Oral"); leave empty cells empty.
- For handwriting, give your best reading of every word.
- Maths: copy every number, sign and expression exactly; never solve, simplify or correct it. Use plain text, not LaTeX: × ÷ + − = ≠ < > ≤ ≥ ± √ π ° % ∠ △ ∥ ⊥ ∴ ∵. Fractions as 3/4, mixed numbers as 2 1/3. Powers with superscripts (x², 10³, a⁵); when a power is not a single number write a^(m+n). Square roots as √25 or √(x + 1). Keep units (cm, m², ₹, kg).
- A sum written vertically (numbers one under another with a line below) goes on one line, e.g. "345 + 127 = ______". Empty boxes to fill (□) are ______.
- Diagrams, figures, graphs, number lines and pictures: do not describe them and do not copy the labels or numbers drawn inside them; write [Diagram] on its own line where one appears. Still copy the question text around it.
- Skip things that are not paper content: phone status bars, app buttons, "Page No" / "Date" boxes, watermarks.
- Do not answer, explain, translate or summarise anything. Output only the transcribed text.`;

// Without these rules the model "improves" Hindi/Marathi words into different ones
// (रिकाम्या जागा -> रिक्तस्थानांमध्ये, करावा -> करतो), reads ळ as ल and drops (घ) options.
const devanagariRules = (language) => `- Copy every Devanagari word EXACTLY as written, letter by letter, including every matra, anusvara, chandrabindu, nukta, half-letter and conjunct. Do NOT correct, modernise, rephrase, replace with a synonym or "improve" any word, even if it looks unusual.
${language === 'mr' ? '- This is Marathi, not Hindi: keep ळ (never write ल or ठ for it), ऱ्य / ऱ्ह (eyelash ra), ॲ / ऑ and Marathi spellings exactly.\n' : ''}- Keep digits in the script they are written in: Devanagari digits (१ २ ३) stay Devanagari, 1 2 3 stay as they are.
- Keep every option of multiple-choice questions, e.g. (क) (ख) (ग) (घ), (अ) (ब) (स) (द) or (१) (२) (३) (४): count them and never drop the last one.
- Keep labels such as प्रश्न 1., प्र. १., (अ), अ), (क), १) and marks such as (5 अंक) or (५ गुण).`;

// A Tesseract draft makes the model keep the exact printed spellings (measured on
// printed Marathi: 93% -> 99% of words right).
const guidedRules = (draft) => `A letter-by-letter OCR engine already read this page. Its draft is below. Where it read a word cleanly its spelling is exact, so prefer the draft's spelling whenever it matches what you see in the image. The draft can also contain junk characters, wrong digits, broken lines, wrong maths symbols or missing words: fix those from the image. Never copy junk that is not in the image.
--- OCR draft ---
${draft}
--- end of draft ---`;

function visionPrompt(language, draft) {
  if (language === 'en') return `${INTRO}\n${BASE_RULES}`;
  const intro = `${INTRO} The page is written in ${LANGUAGE_NAMES[language]} (Devanagari script); English words and maths may also appear.`;
  return [intro, BASE_RULES, devanagariRules(language), draft ? guidedRules(draft) : ''].filter(Boolean).join('\n');
}

// Vision tokens grow with image area and the Groq free tier allows only ~7000 image
// tokens per minute, so pieces are sent at a width that is still easy to read.
// Devanagari matras and conjuncts need more pixels, so Hindi/Marathi pages are sent larger.
const OCR_WIDTH = { en: [0, 1100], deva: [1300, 1400] };

async function visionOcr(jpeg, { language = 'en', draft = '', onWait } = {}) {
  const [minWidth, maxWidth] = language === 'en' ? OCR_WIDTH.en : OCR_WIDTH.deva;
  const width = (await sharp(jpeg).metadata()).width || 0;
  const target = width > maxWidth ? maxWidth : width < minWidth ? minWidth : 0;
  const sized = target ? await sharp(jpeg).resize({ width: target }).jpeg({ quality: 88 }).toBuffer() : jpeg;
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
          { type: 'text', text: visionPrompt(language, draft) },
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
  const flat = (v) => v.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
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

const TESSERACT_LANG = { en: 'eng', hi: 'hin', mr: 'mar' };

class TesseractReader {
  constructor(language = 'en') {
    this.lang = TESSERACT_LANG[language] || 'eng';
  }

  async read(jpeg) {
    if (!this.worker) {
      const { createWorker } = await import('tesseract.js');
      fs.mkdirSync(config.tesseractCache, { recursive: true });
      // The first Hindi/Marathi read downloads that language's data (2-3 MB) into the cache.
      this.worker = await createWorker(this.lang, 1, { cachePath: config.tesseractCache });
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
    return { text: data.text || '', confidence: Number(data.confidence) || 0 };
  }

  async close() {
    if (this.worker) await this.worker.terminate().catch(() => {});
    this.worker = null;
  }
}

// Tesseract is sure of itself on printed pages (80-90) and not on handwriting.
const PRINTED_CONFIDENCE = 65;

const devaWords = (text) =>
  String(text || '')
    .split(/[^\u0900-\u0963\u0966-\u097F]+/)
    .filter((w) => w.length >= 2 && /[\u0904-\u0939]/.test(w));

function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

// Words of the final text that the letter-by-letter reader did not see on the page.
// They are highlighted in the editor so the teacher checks them against the photo.
export function wordsToCheck(finalText, draftText, limit = 60) {
  const draft = [...new Set(devaWords(draftText))];
  const seen = new Set(draft);
  const out = new Map();
  for (const word of devaWords(finalText)) {
    if (seen.has(word) || out.has(word)) continue;
    let alt = '';
    let best = Math.max(1, Math.floor([...word].length / 3)) + 1;
    for (const d of draft) {
      const dist = editDistance(word, d);
      if (dist < best) {
        best = dist;
        alt = d;
      }
    }
    out.set(word, alt);
    if (out.size >= limit) break;
  }
  return [...out].map(([word, alt]) => ({ word, alt }));
}

/**
 * Reads every image (in order) and returns the combined text.
 * English: Groq vision, Tesseract as the fallback.
 * Hindi/Marathi: Tesseract first; on printed pages its draft guides the Groq vision model.
 * @param {{buffer: Buffer, width: number, height: number}[]} images normalized images
 * @param {(done: number, total: number) => Promise<void>|void} onProgress
 * @param {(seconds: number) => Promise<void>|void} onWait called while waiting out a Groq rate limit
 * @param {{ language?: 'en'|'hi'|'mr' }} options
 */
export async function extractText(images, onProgress = () => {}, onWait = () => {}, { language = 'en' } = {}) {
  const useGroq = groqEnabled();
  const allowTesseract = config.ocrFallback === 'tesseract';
  const devanagari = language === 'hi' || language === 'mr';
  if (!useGroq && !allowTesseract) {
    throw new Error('No OCR engine available. Set GROQ_API_KEY (recommended) or OCR_FALLBACK=tesseract.');
  }

  const pages = [];
  for (const img of images) pages.push(await sliceForOcr(img.buffer, img.width, img.height));
  const total = pages.reduce((n, p) => n + p.length, 0);

  const tesseract = new TesseractReader(language);
  const methods = new Set();
  const warnings = [];
  const check = new Map();
  let handwritten = 0;
  let draftFailed = false;
  const pageTexts = [];
  let done = 0;
  try {
    for (const pieces of pages) {
      const texts = [];
      for (const piece of pieces) {
        let text = null;
        let draft = null;
        if (devanagari && !draftFailed) {
          try {
            draft = await tesseract.read(piece);
          } catch (err) {
            draftFailed = true;
            warnings.push(`The ${LANGUAGE_NAMES[language]} letter-check could not run (${err.message}); words were read by AI only, so check spellings.`);
          }
        }
        const printed = Boolean(draft && draft.confidence >= PRINTED_CONFIDENCE && draft.text.trim());
        if (devanagari && draft && !printed) handwritten += 1;

        if (useGroq) {
          try {
            text = await visionOcr(piece, { language, draft: printed ? draft.text.trim() : '', onWait });
            methods.add(printed ? 'groq-vision+tesseract' : 'groq-vision');
            if (printed) for (const w of wordsToCheck(text, draft.text)) if (!check.has(w.word)) check.set(w.word, w.alt);
          } catch (err) {
            if (!allowTesseract) throw err;
            warnings.push(`AI reading failed for one part (${err.message}); used basic OCR instead, so check that part.`);
          }
        }
        if (text === null) {
          text = draft ? draft.text : (await tesseract.read(piece)).text;
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

  if (!useGroq) {
    warnings.push(
      devanagari
        ? `GROQ_API_KEY is not set: used basic OCR (Tesseract ${LANGUAGE_NAMES[language]}). It reads clear printed text only; handwriting will not be read.`
        : 'GROQ_API_KEY is not set: used basic OCR (Tesseract). Handwriting will not be read well.',
    );
  }
  if (useGroq && handwritten) {
    warnings.push(
      `${handwritten === total ? 'The photos look handwritten' : 'Some parts look handwritten'}: ${LANGUAGE_NAMES[language]} handwriting is read less accurately than print, so compare each line with the photo in "Edit questions".`,
    );
  }
  const method = methods.size > 1 ? 'mixed' : [...methods][0] || 'none';
  const review = { words: [...check].map(([word, alt]) => ({ word, alt })) };
  return { text: pageTexts.join('\n\n'), method, warnings, review };
}
