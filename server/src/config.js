import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = path.resolve(__dirname, '..');
export const SEED_DIR = path.join(SERVER_DIR, 'seed');

// Always read server/.env, no matter which folder the server is started from.
dotenv.config({ path: path.join(SERVER_DIR, '.env'), quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 5000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/image_to_excel',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Public DNS used when this PC's DNS cannot resolve an Atlas "mongodb+srv://" address.
  dnsServers: (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Optional: path to a built client (e.g. ../client/dist) to serve the app from this server.
  clientDist: process.env.CLIENT_DIST_DIR ? path.resolve(SERVER_DIR, process.env.CLIENT_DIST_DIR) : '',

  maxImages: num(process.env.MAX_IMAGES, 10),
  maxImageMb: num(process.env.MAX_IMAGE_MB, 15),
  maxTemplateMb: num(process.env.MAX_TEMPLATE_MB, 5),

  // 'tesseract' = free local OCR when Groq is missing or fails (good for printed text, weak on handwriting)
  // 'none'      = fail instead of falling back
  ocrFallback: (process.env.OCR_FALLBACK || 'tesseract').toLowerCase(),
  tesseractCache: path.join(SERVER_DIR, '.cache', 'tesseract'),

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    baseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    // Reads the photo (OCR). Must be a Groq model that accepts images.
    visionModel: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
    // Turns the OCR text into questions / sub-questions / marks (JSON).
    textModel: process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b',
    timeoutMs: num(process.env.GROQ_TIMEOUT_MS, 120000),
  },
};

export const groqEnabled = () => Boolean(config.groq.apiKey);
