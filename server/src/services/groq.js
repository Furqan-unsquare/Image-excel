import { config, groqEnabled } from '../config.js';

export { groqEnabled };

export class GroqError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Groq says how long to wait: "Please try again in 11.92s", "in 1m2.5s", "in 450ms".
function waitFromMessage(message, retryAfterHeader) {
  const header = Number(retryAfterHeader);
  let ms = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
  const m = /try again in\s+([\d.hms]+)/i.exec(message || '');
  if (m) {
    const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000 };
    let total = 0;
    for (const [, n, unit] of m[1].matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) total += Number(n) * unitMs[unit];
    ms = Math.max(ms, total);
  }
  return ms;
}

// The free tier allows only a few thousand tokens per minute, so per-minute
// limits are waited out (up to this much in total per call) instead of failing.
const RATE_LIMIT_BUDGET_MS = 4 * 60 * 1000;

function friendlyError(status, message) {
  if (status === 401) return 'The Groq API key is invalid. Check GROQ_API_KEY in server/.env.';
  if (status === 429) return `Groq usage limit reached (${message.slice(0, 200)}). Try again later or upgrade the Groq plan.`;
  if (status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(message)) {
    return `Groq model not available: ${message.slice(0, 200)}. Update GROQ_VISION_MODEL / GROQ_TEXT_MODEL in server/.env.`;
  }
  return `Groq ${status}: ${message.slice(0, 400)}`;
}

async function post(body, { onWait } = {}) {
  if (!groqEnabled()) throw new GroqError('GROQ_API_KEY is not set', 0);

  let waited = 0;
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.groq.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.groq.timeoutMs),
      });
    } catch (err) {
      if (attempt < 2) {
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      throw new GroqError(`Could not reach Groq: ${err.message}`, 0);
    }

    if (res.ok) return res.json();

    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message || text;
    } catch {
      /* keep raw text */
    }
    message = String(message);

    if (res.status === 429 && !/per day|\b(TPD|RPD)\b/i.test(message)) {
      const wait = Math.min(Math.max(waitFromMessage(message, res.headers.get('retry-after')), 1000) + 750, 65000);
      if (waited + wait <= RATE_LIMIT_BUDGET_MS) {
        waited += wait;
        await onWait?.(Math.ceil(wait / 1000));
        await sleep(wait);
        continue;
      }
    } else if (res.status >= 500 && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new GroqError(friendlyError(res.status, message), res.status);
  }
}

// Optional parameters (reasoning_effort, json_schema) are not supported by every
// model, so each call carries fallbacks that are tried only after a 400 response.
async function completeWithFallbacks(variants, options) {
  let lastError;
  for (const body of variants) {
    try {
      const data = await post(body, options);
      return data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      lastError = err;
      if (err.status !== 400) throw err;
    }
  }
  throw lastError;
}

const stripThinking = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export async function groqText({ model, messages, maxTokens = 4096, reasoningEffort, temperature = 0, onWait }) {
  const base = { model, messages, temperature, max_completion_tokens: maxTokens };
  const variants = reasoningEffort ? [{ ...base, reasoning_effort: reasoningEffort }, base] : [base];
  return stripThinking(await completeWithFallbacks(variants, { onWait }));
}

export async function groqJSON({ model, messages, schema, schemaName = 'result', maxTokens = 8192, reasoningEffort, onWait }) {
  const base = { model, messages, temperature: 0, max_completion_tokens: maxTokens };
  const formats = [];
  if (schema) formats.push({ type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } });
  formats.push({ type: 'json_object' });

  const variants = [];
  for (const response_format of formats) {
    if (reasoningEffort) variants.push({ ...base, response_format, reasoning_effort: reasoningEffort });
    variants.push({ ...base, response_format });
  }
  return parseJsonLoose(stripThinking(await completeWithFallbacks(variants, { onWait })));
}

export function parseJsonLoose(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('The AI response was not valid JSON');
  }
}
