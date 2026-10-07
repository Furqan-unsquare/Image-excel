// Turns OCR text into structured paper content:
// { meta, sections: [{ title, questions: [{ number, text, marks, note, items: [{ label, text, options, answer }], table }] }] }
// Uses Groq when configured, otherwise a rule-based parser.
import { config, groqEnabled } from '../config.js';
import { groqJSON } from './groq.js';

const META_KEYS = ['school', 'exam', 'subject', 'className', 'totalMarks', 'time', 'date'];

const stringProps = (keys) => Object.fromEntries(keys.map((k) => [k, { type: 'string' }]));

const PAPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meta', 'sections'],
  properties: {
    meta: { type: 'object', additionalProperties: false, required: META_KEYS, properties: stringProps(META_KEYS) },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'questions'],
        properties: {
          title: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['number', 'text', 'marks', 'note', 'items', 'table'],
              properties: {
                number: { type: 'string' },
                text: { type: 'string' },
                marks: { type: 'string' },
                note: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label', 'text', 'options', 'answer'],
                    properties: {
                      label: { type: 'string' },
                      text: { type: 'string' },
                      options: { type: 'array', items: { type: 'string' } },
                      answer: { type: 'string' },
                    },
                  },
                },
                table: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['headers', 'rows'],
                  properties: {
                    headers: { type: 'array', items: { type: 'string' } },
                    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You convert OCR text from photos of school question papers (printed or handwritten; sometimes notebook pages that also contain answers) into structured JSON for an exam paper generator.

Reply with JSON only, in exactly this shape:
{"meta":{"school":"","exam":"","subject":"","className":"","totalMarks":"","time":"","date":""},
 "sections":[{"title":"","questions":[{"number":"1","text":"Fill in the blanks","marks":"5","note":"",
   "items":[{"label":"1","text":"Honesty is our ______","options":[],"answer":""}],
   "table":{"headers":[],"rows":[]}}]}]}

Rules
1. sections: subject or part headings such as "HISTORY", "CIVICS", "Section A", "Part II". If there are none, return one section with title "".
2. questions: main question headings such as "Q1. Fill in the blanks (5 Marks)", "Que 4 Name the following", "Q5] Define the following".
   - number: only the number as written ("1", "4", "IV"); "" if none.
   - text: the instruction without the number and without the marks, e.g. "Fill in the blanks".
   - marks: only the number from "(5 Marks)", "[2 M]", "(3marks)", "(5 Mark's)" -> "5"; "" if not given.
3. items: every sub-question under a heading, in order.
   - label: the item's own label without punctuation ("1", "2", "A", "a", "iv"); "" if none.
   - text: the item without its label. Keep fill-in blanks as "______".
   - Several items on one line (e.g. "1.BREH____   2. TEER____") are separate items.
4. options: when an item offers separate choices listed after or below it (e.g. "Zoom in / Redo / Undo", "(a) ... (b) ..."), put each choice in options and keep only the question in text. Choices inside a sentence, like "(Sapota / Egg) Comes From A Tree", stay in text with options [].
5. answer: only when the source shows the answer (lines starting with "Ans", "Answer", "A:"). For "full form" / "define" items written like "CUI = Character User Interface", text is only "CUI" and answer is "Character User Interface". Never invent answers; otherwise "".
6. note: lines that belong to the heading but are not items, e.g. a word bank "( Coins, Letters, Forts )" or "[Picture: human body diagram]".
7. table: only when students must fill a grid (classify into columns, match the following). headers = column titles; rows = cell texts, "" for empty cells. A line of column titles under a "classify / sort / group" question (e.g. "Material | Written | Oral" or "Material Written Oral") is the table header, not an item. Otherwise {"headers":[],"rows":[]}.
8. Never drop content. Text continues across pages: items that appear before the next heading belong to the previous question. If the text STARTS with items that have no heading, keep them as a first question with number "" and text "" and keep their labels, e.g. "6] To cancel the last action / Zoom in / Redo / Undo" -> {"number":"","text":"","items":[{"label":"6","text":"To cancel the last action","options":["Zoom in","Redo","Undo"],"answer":""}]}.
9. Fix obvious OCR errors (broken words, stray symbols, "0l." read for "Q1.") but do not rephrase, translate, reorder or drop content. Keep the teacher's wording.
10. Ignore non-content: page numbers, "Page No"/"Date" boxes, phone status bars, app buttons, watermarks.
11. meta.school, exam, className, totalMarks, time, date: copy from the paper's own header if shown; "" when not shown (do not guess these).
12. meta.subject: ALWAYS fill it. Use the subject written on the paper; if none is written, name the school subject the questions belong to in one or two words, e.g. "Computer" (booting, GUI, taskbar, operating system), "EVS" or "Science" (plants, animals, food, senses), "History", "Geography", "Civics", "English", "Maths". Leave "" only when the questions give no clue.`;

export async function structureWithGroq(text, { onWait } = {}) {
  return groqJSON({
    onWait,
    model: config.groq.textModel,
    reasoningEffort: 'low',
    maxTokens: 16000,
    schema: PAPER_SCHEMA,
    schemaName: 'question_paper',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `OCR text (pages separated by blank lines):\n\n${text}` },
    ],
  });
}

// ---------------------------------------------------------------------------
// Rule-based parser (used when Groq is not configured or fails)
// ---------------------------------------------------------------------------
const QUESTION_LINE = /^(?:Q(?:ue(?:s(?:tion)?)?)?|0)\s*\.?\s*(?:no\.?\s*)?(\d{1,3}|[IVX]{1,5})(?![A-Za-z])\s*[.):\]\-–]*\s*(.*)$/i;
const ITEM_START = /^\(?(\d{1,2}|[A-Za-z]|[ivx]{1,4})\s*[.)\]]\s*(?=\S)/;
const ANSWER_LINE = /^ans(?:wer)?\s*[\].:)\-–]*\s*(.*)$/i;
const MARKS_TAIL = /[([]\s*(\d+(?:\.\d+)?)\s*(?:marks?|mark'?s|mks?|m)\s*\.?\s*[)\]]\s*\.?\s*$|[-–,]?\s*(\d+(?:\.\d+)?)\s*(?:marks?|mark'?s)\s*\.?\s*$/i;
const NOISE = /^(page\s*no\.?|date|page\s*\d+)\s*[:.]?\s*$/i;

export function splitMarks(text) {
  const t = String(text || '').trim();
  const m = MARKS_TAIL.exec(t);
  if (!m) return { text: t, marks: '' };
  return { text: t.slice(0, m.index).trim(), marks: m[1] || m[2] || '' };
}

// "1.BREH____ 2. TEER____" -> two items. Only splits on the next expected number.
function splitItems(line) {
  const first = ITEM_START.exec(line);
  if (!first) return null;
  const items = [];
  let label = first[1];
  let rest = line.slice(first[0].length);
  for (;;) {
    const n = Number(label);
    if (!Number.isInteger(n)) break;
    const re = new RegExp(`\\s(\\(?${n + 1}\\s*[.)\\]]\\s*)(?=\\S)`);
    const m = re.exec(rest);
    if (!m) break;
    items.push({ label, text: rest.slice(0, m.index).trim() });
    label = String(n + 1);
    rest = rest.slice(m.index + m[0].length);
  }
  items.push({ label, text: rest.trim() });
  return items;
}

// Basic OCR reads printed blanks ("______") as a run of spaces, often followed by
// one or two junk characters where the line ended, and reads "I" as "|".
function cleanOcrLine(raw) {
  return String(raw || '')
    .replace(/\s+$/, '')
    .replace(/\s{4,}[^\s\w]{0,2}\w?\s*$/, ' ______')
    .replace(/([^\s_])\s{4,}(?=\S)/g, '$1 ______ ')
    .replace(/^(\d{1,2})(?=[A-Z]{3,}_)/, '$1.')
    .replace(/(^|[\s.])\|(?=\s|[A-Za-z])\s*/g, '$1I ')
    .trim();
}

const isSectionTitle = (line) =>
  /^[A-Z][A-Z &/\-]{2,40}$/.test(line) && line.split(/\s+/).length <= 4 && !/^(ANS|Q\d)/.test(line);

export function parseWithRules(text) {
  const paper = { meta: {}, sections: [] };
  let section = null;
  let question = null;
  let item = null;
  let lastKind = null;

  const ensureSection = () => {
    if (!section) {
      section = { title: '', questions: [] };
      paper.sections.push(section);
    }
    return section;
  };
  const newQuestion = (q) => {
    question = { number: '', text: '', marks: '', note: '', items: [], table: { headers: [], rows: [] }, ...q };
    ensureSection().questions.push(question);
    item = null;
    return question;
  };

  const lines = String(text || '')
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter((l) => l && !NOISE.test(l) && l.replace(/[^A-Za-z0-9]/g, '').length >= 3);
  // Upper-case lines above the first question are usually the school header;
  // only the one directly above it can be a section title.
  const firstQuestion = lines.findIndex((l) => /^q/i.test(l) && QUESTION_LINE.test(l));

  for (const [index, line] of lines.entries()) {
    if (isSectionTitle(line) && (firstQuestion < 0 || index >= firstQuestion - 1)) {
      section = { title: line, questions: [] };
      paper.sections.push(section);
      question = null;
      item = null;
      lastKind = 'section';
      continue;
    }

    let m = QUESTION_LINE.exec(line);
    if (m && (/^q/i.test(line) || m[2])) {
      const { text: qText, marks } = splitMarks(m[2]);
      newQuestion({ number: m[1], text: qText, marks });
      lastKind = 'question';
      continue;
    }

    m = ANSWER_LINE.exec(line);
    if (m) {
      if (!question) newQuestion({});
      if (!item) {
        item = { label: '', text: '', options: [], answer: '' };
        question.items.push(item);
      }
      item.answer = [item.answer, m[1]].filter(Boolean).join(' ');
      lastKind = 'answer';
      continue;
    }

    const parts = splitItems(line);
    if (parts) {
      if (!question) newQuestion({});
      for (const part of parts) {
        const full = /^(.+?)\s*=\s*(.+)$/.exec(part.text);
        item = full
          ? { label: part.label, text: full[1], options: [], answer: full[2] }
          : { label: part.label, text: part.text, options: [], answer: '' };
        question.items.push(item);
      }
      lastKind = 'item';
      continue;
    }

    if (lastKind === 'answer' && item) item.answer += ` ${line}`;
    else if (item) item.text += ` ${line}`;
    else if (question) question.note = [question.note, line].filter(Boolean).join(' ');
    else if (!paper.sections.length) {
      // Text before any question: likely header lines; keep the first as the subject hint only.
      continue;
    }
  }
  return paper;
}

// ---------------------------------------------------------------------------
// Normalisation shared by both paths (and by user edits)
// ---------------------------------------------------------------------------
const str = (v) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

function normalizeItem(raw) {
  const it = raw && typeof raw === 'object' ? raw : { text: raw };
  let label = str(it.label).replace(/[^0-9A-Za-z]/g, '');
  let text = str(it.text);
  if (!label) {
    const m = /^\(?(\d{1,2}|[A-Za-z]|[ivx]{1,4})\s*[.)\]]\s*/.exec(text);
    if (m && text.length > m[0].length) {
      label = m[1];
      text = text.slice(m[0].length);
    }
  }
  let options = (Array.isArray(it.options) ? it.options : []).map(str).filter(Boolean).slice(0, 10);
  // Choices already written inside the sentence ("(Sapota / Egg) comes from a tree") are not repeated below it.
  const flat = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (options.length && options.every((o) => flat(o) && flat(text).includes(flat(o)))) options = [];
  let answer = str(it.answer);
  // "CUI = Character User Interface": the abbreviation is the question, the rest its answer.
  const fullForm = /^([A-Z][A-Z0-9.&/-]{1,14})\s*=\s*([^_=]{2,})$/.exec(text);
  if (fullForm && !answer) {
    text = fullForm[1];
    answer = fullForm[2].trim();
  }
  return { label, text, options, answer };
}

function normalizeQuestion(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const number = str(q.number).replace(/^Q(?:ue(?:s(?:tion)?)?)?\s*\.?\s*(?:no\.?\s*)?/i, '').replace(/[^0-9A-Za-z]/g, '');
  let text = str(q.text).replace(/^Q(?:ue(?:s(?:tion)?)?)?\s*\.?\s*\d{1,3}\s*[.):\]\-–]*\s*/i, '');
  let marks = str(q.marks);
  const split = splitMarks(text);
  if (split.marks) {
    text = split.text;
    if (!marks) marks = split.marks;
  }
  const mNum = /\d+(?:\.\d+)?/.exec(marks);
  const items = (Array.isArray(q.items) ? q.items : []).map(normalizeItem).filter((i) => i.text || i.answer || i.options.length);
  // A sub-question with no heading that was turned into its own "question" (heading text == item text).
  let questionNumber = number;
  if (items.length === 1 && text && items[0].text.toLowerCase() === text.toLowerCase() && !marks) {
    if (!items[0].label) items[0].label = number;
    text = '';
    questionNumber = '';
  }
  const table = q.table && typeof q.table === 'object' ? q.table : {};
  let headers = (Array.isArray(table.headers) ? table.headers : []).map(str);
  let rows = (Array.isArray(table.rows) ? table.rows : [])
    .filter(Array.isArray)
    .map((r) => r.map(str))
    .slice(0, 40);
  // "Classify …" followed by a single line of column titles ("Material Written Oral"):
  // that line is the header of a blank table, not a sub-question.
  if (!headers.length && !rows.length && items.length === 1 && !items[0].label && /classif|categori|sort|group|arrange/i.test(text)) {
    const cells = items[0].text.includes('|')
      ? items[0].text.split('|').map((c) => c.trim()).filter(Boolean)
      : items[0].text.split(/\s+/);
    if (cells.length >= 2 && cells.length <= 6 && cells.every((c) => /^[A-Z][\w -]{0,30}$/.test(c))) {
      headers = cells;
      items.length = 0;
    }
  }
  return {
    number: questionNumber,
    text,
    marks: mNum ? mNum[0] : '',
    note: str(q.note),
    items,
    table: headers.some(Boolean) || rows.length ? { headers, rows } : { headers: [], rows: [] },
  };
}

export function normalizeContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const meta = Object.fromEntries(META_KEYS.map((k) => [k, str(src.meta?.[k])]));
  let sections = (Array.isArray(src.sections) ? src.sections : []).map((s) => ({
    title: str(s?.title),
    questions: (Array.isArray(s?.questions) ? s.questions : [])
      .map(normalizeQuestion)
      .filter((q) => q.text || q.number || q.note || q.items.length || q.table.headers.length || q.table.rows.length),
  }));
  sections = sections.filter((s) => s.title || s.questions.length);
  if (!sections.length) sections = [{ title: '', questions: [] }];
  const header = Array.isArray(src.header)
    ? src.header.filter((h) => h && h.address).map((h) => ({ address: String(h.address), text: String(h.text ?? '') }))
    : undefined;
  return { meta, sections, ...(header ? { header } : {}) };
}

// Questions whose marks were not on the photo get marks the way the format gives
// them: the most common marks on this paper, else the format's rule
// ('fixed' = same value for every question, 'per-item' = one per sub-question).
export function applyMissingMarks(content, profile) {
  const rule = profile?.marks?.whenMissing || (profile?.marks?.col ? 'fixed' : 'none');
  if (rule === 'none') return null;
  const headed = (content.sections || []).flatMap((s) => s.questions || []).filter((q) => q.text || q.number);
  const present = headed.map((q) => Number(q.marks)).filter((n) => Number.isFinite(n) && n > 0);
  const missing = headed.filter((q) => !q.marks);
  if (!missing.length) return null;

  const counts = new Map();
  for (const n of present) counts.set(n, (counts.get(n) || 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fixed = common ?? (profile.marks.defaultValue || 2);
  for (const q of missing) {
    const value = rule === 'per-item' && !common && q.items?.length ? q.items.length : fixed;
    q.marks = String(value);
  }
  const how = common
    ? `${fixed} marks each (the most common marks on this paper)`
    : rule === 'per-item'
      ? '1 mark per sub-question (as in your format)'
      : `${fixed} marks each (as in your format)`;
  return `Marks were not on the photo for ${missing.length} question${missing.length > 1 ? 's' : ''}, so ${how} were used. Change them in "Edit questions" if needed.`;
}

export function totalMarks(content) {
  let sum = 0;
  let any = false;
  for (const s of content.sections || []) {
    for (const q of s.questions || []) {
      const n = Number(q.marks);
      if (Number.isFinite(n) && n > 0) {
        sum += n;
        any = true;
      }
    }
  }
  return any ? String(Math.round(sum * 100) / 100) : '';
}

const HEADER_FIELDS = [
  { key: 'subject', re: /^(subject\s*(?:name)?\s*[:\-–.]*\s*)(.*)$/i },
  { key: 'className', re: /^((?:std|standard|class|grade)\.?\s*[:\-–.]*\s*)(.*)$/i },
  { key: 'totalMarks', re: /^((?:total\s*|max(?:imum)?\.?\s*)?marks?\s*[:\-–.]*\s*)(.*)$/i },
  { key: 'time', re: /^((?:time|duration)\s*[:\-–.]*\s*)(.*)$/i },
  { key: 'date', re: /^(date\s*[:\-–.]*\s*)(.*)$/i },
];

function fillSegment(segment, values) {
  const lead = /^\s*/.exec(segment)[0];
  const trail = /\s*$/.exec(segment.slice(lead.length))[0];
  const core = segment.slice(lead.length, segment.length - trail.length);
  for (const field of HEADER_FIELDS) {
    const m = field.re.exec(core);
    if (m && values[field.key]) return lead + m[1] + values[field.key] + trail;
  }
  return segment;
}

// Template header cells with "Subject:-", "Std:-", "Marks:" etc. filled from the photo.
export function buildHeaderLines(profile, content) {
  const values = { ...content.meta };
  if (!values.totalMarks) values.totalMarks = totalMarks(content);
  return (profile.header?.cells || []).map((cell) => {
    const original = String(cell.text ?? '');
    const text = original
      .split(/(\s{3,})/)
      .map((part, i) => (i % 2 === 0 ? fillSegment(part, values) : part))
      .join('');
    return { address: cell.address, text };
  });
}

export function paperTitle(content, fallback = 'Question paper') {
  const subject = content.meta?.subject;
  const exam = content.meta?.exam;
  if (subject && exam) return `${subject} – ${exam}`;
  if (subject) return `${subject} paper`;
  const firstSection = content.sections?.find((s) => s.title)?.title;
  if (firstSection) return `${firstSection} paper`;
  return fallback;
}

export async function structureText(text, { onWait } = {}) {
  const warnings = [];
  if (groqEnabled()) {
    try {
      const raw = await structureWithGroq(text, { onWait });
      const content = normalizeContent(raw);
      if (content.sections.some((s) => s.questions.length)) return { content, method: 'groq', warnings };
      warnings.push('The AI found no questions; used built-in rules instead.');
    } catch (err) {
      warnings.push(`AI structuring failed (${err.message}); used built-in rules instead. Please review the questions.`);
    }
  }
  return { content: normalizeContent(parseWithRules(text)), method: 'rules', warnings };
}
