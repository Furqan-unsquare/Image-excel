// Turns OCR text into structured paper content:
// { meta, sections: [{ title, questions: [{ number, text, marks, note, items: [{ label, text, options, answer }], table }] }] }
// Uses Groq when configured, otherwise a rule-based parser.
import { config, groqEnabled } from '../config.js';
import { groqJSON } from './groq.js';
import { LANGUAGE_NAMES, toDevanagariDigits, toLatinDigits } from '../utils/lang.js';
import { labelNumbers } from '../utils/numbering.js';

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

const SYSTEM_PROMPT = `You convert OCR text from photos of school question papers (printed or handwritten; sometimes notebook pages that also contain answers) into structured JSON for an exam paper generator. Papers can be in English, Hindi or Marathi (Devanagari script), and can be maths papers.

Reply with JSON only, in exactly this shape:
{"meta":{"school":"","exam":"","subject":"","className":"","totalMarks":"","time":"","date":""},
 "sections":[{"title":"","questions":[{"number":"1","text":"Fill in the blanks","marks":"5","note":"",
   "items":[{"label":"1","text":"Honesty is our ______","options":[],"answer":""}],
   "table":{"headers":[],"rows":[]}}]}]}

Rules
1. sections: subject or part headings such as "HISTORY", "CIVICS", "Section A", "Part II", "विभाग अ", "खंड - ब", "भाग १". If there are none, return one section with title "".
2. questions: main question headings such as "Q1. Fill in the blanks (5 Marks)", "Que 4 Name the following", "Q5] Define the following", "प्रश्न 1. रिक्त स्थान भरिए। (5 अंक)", "प्र. १. रिकाम्या जागा भरा. (५ गुण)", "प्र. २ रा) Solve.".
   - number: only the number as written ("1", "4", "IV", "१"); "" if none.
   - text: the instruction without the number and without the marks, e.g. "Fill in the blanks", "रिक्त स्थान भरिए।".
   - marks: only the number, in 0-9 digits, from "(5 Marks)", "[2 M]", "(3marks)", "(5 Mark's)", "(5 अंक)", "(५ गुण)" -> "5"; "" if not given.
3. items: every sub-question under a heading, in order.
   - label: the item's own label without punctuation ("1", "2", "A", "a", "iv", "१", "अ", "आ", "क"); "" if none.
   - text: the item without its label. Keep fill-in blanks as "______".
   - Several items on one line (e.g. "1.BREH____   2. TEER____") are separate items.
4. options: when an item offers separate choices listed after or below it (e.g. "Zoom in / Redo / Undo", "(a) ... (b) ...", "(क) अग्नि (ख) जल (ग) पवन (घ) आकाश", "(१) रात्र (२) सकाळ"), put each choice without its label in options and keep only the question in text. Choices inside a sentence, like "(Sapota / Egg) Comes From A Tree", stay in text with options [].
5. answer: only when the source shows the answer (lines starting with "Ans", "Answer", "A:", "उत्तर :"). For "full form" / "define" items written like "CUI = Character User Interface", text is only "CUI" and answer is "Character User Interface". Never invent or work out answers; otherwise "".
6. note: lines that belong to the heading but are not items, e.g. a word bank "( Coins, Letters, Forts )". A "[Diagram]" line goes in the note (or stays in the item text) of the question it belongs to.
7. table: only when students must fill a grid (classify into columns, match the following). headers = column titles; rows = cell texts, "" for empty cells. A line of column titles under a "classify / sort / group" question (e.g. "Material | Written | Oral" or "Material Written Oral") is the table header, not an item. "Match the following" / "जोड़ी मिलाइए" / "जोड्या जुळवा" is always a table and never items: headers = the two column titles ("Column A", "'अ' गट"), one row per line with both cells keeping their labels, e.g. "१) वाघ   अ) दूध" -> ["१) वाघ", "अ) दूध"]. Otherwise {"headers":[],"rows":[]}.
8. Never drop content. Text continues across pages: items that appear before the next heading belong to the previous question. If the text STARTS with items that have no heading, keep them as a first question with number "" and text "" and keep their labels, e.g. "6] To cancel the last action / Zoom in / Redo / Undo" -> {"number":"","text":"","items":[{"label":"6","text":"To cancel the last action","options":["Zoom in","Redo","Undo"],"answer":""}]}.
9. Fix obvious OCR errors in English text (broken words, stray symbols, "0l." read for "Q1.") but do not rephrase, translate, reorder or drop content. Keep the teacher's wording. Copy Hindi and Marathi words exactly, letter by letter: never correct, translate or replace them.
10. Ignore non-content: page numbers, "Page No"/"Date" boxes, phone status bars, app buttons, watermarks.
11. meta.school, exam, className, totalMarks, time, date: copy from the paper's own header if shown (also "विषय", "कक्षा", "इयत्ता", "पूर्णांक", "गुण", "समय", "वेळ", "दिनांक"); "" when not shown (do not guess these).
12. meta.subject: ALWAYS fill it. Use the subject written on the paper; if none is written, name the school subject the questions belong to in one or two words, e.g. "Computer" (booting, GUI, taskbar, operating system), "EVS" or "Science" (plants, animals, food, senses), "History", "Geography", "Civics", "English", "Maths" (numbers, fractions, equations, geometry). For a Hindi or Marathi paper write it in that language, e.g. "हिंदी", "मराठी", "गणित", "विज्ञान", "इतिहास". Leave "" only when the questions give no clue.
13. Maths: copy every number, sign and expression exactly as in the OCR text (×, ÷, −, fractions like 3/4, powers like x², √, π, units). Never solve, simplify, correct or complete a sum. Each sum or problem under a heading such as "Solve", "Simplify", "Find the value", "हल कीजिए", "सोडवा" is one item, e.g. {"label":"a","text":"3/4 + 1/8 = ______"}. A decimal number such as "2.5 + 1.2" at the start of a line is item text, not label "2".`;

export async function structureWithGroq(text, { onWait, language = 'en' } = {}) {
  const lang =
    language === 'en'
      ? ''
      : `The paper is in ${LANGUAGE_NAMES[language]}. Keep all ${LANGUAGE_NAMES[language]} text exactly as written (do not translate it).\n\n`;
  return groqJSON({
    onWait,
    model: config.groq.textModel,
    reasoningEffort: 'low',
    maxTokens: 16000,
    schema: PAPER_SCHEMA,
    schemaName: 'question_paper',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${lang}OCR text (pages separated by blank lines):\n\n${text}` },
    ],
  });
}

// ---------------------------------------------------------------------------
// Rule-based parser (used when Groq is not configured or fails)
// ---------------------------------------------------------------------------
// "Q1.", "Que 4", "प्रश्न 1.", "प्र. १.", "प्र. २ रा)" (Marathi ordinal after the number)
const QUESTION_LINE =
  /^(?:Q(?:ue(?:s(?:tion)?)?)?|0|प्रश्न|प्र)\s*\.?\s*(?:no\.?\s*|क्र(?:मांक)?\.?\s*)?([0-9\u0966-\u096F]{1,3}|[IVX]{1,5})(?![A-Za-z0-9\u0966-\u096F])\s*(?:(?:ला|रा|था|वा)(?![\u0900-\u097F]))?\s*[.):\]\-–]*\s*(.*)$/i;
const QUESTION_PREFIX = /^(q|प्र)/i;
// Item labels: 1. 2) (a) iv) १) (अ) क) — "2.5 + 1" is a number, not label "2".
const LABEL = '(?:\\d{1,2}|[\u0966-\u096F]{1,2}|[A-Za-z]|[ivx]{1,4}|[\\u0904-\\u0939][\\u0902\\u0903]?)';
const ITEM_START = new RegExp(`^\\(?(${LABEL})\\s*(?:[)\\]]|\\.(?![0-9]))\\s*(?=\\S)`);
const ANSWER_LINE = /^(?:ans(?:wer)?\s*[\].:)\-–]*|उत्तर\s*[:\-–.)\]]+)\s*(.*)$/i;
const NUM = '[0-9\u0966-\u096F]+(?:\\.[0-9\u0966-\u096F]+)?';
const MARKS_TAIL = new RegExp(
  `[([]\\s*(${NUM})\\s*(?:marks?|mark'?s|mks?|m|अंक|गुण)\\s*\\.?\\s*[)\\]]\\s*[.।]?\\s*$|[-–,]?\\s*(${NUM})\\s*(?:marks?|mark'?s|अंक|गुण)\\s*[.।]?\\s*$`,
  'i',
);
const NOISE = /^(page\s*no\.?|date|page\s*\d+|दिनांक|पृष्ठ\s*[0-9\u0966-\u096F]*|पान\s*क्र\.?)\s*[:.]?\s*$/i;

export function splitMarks(text) {
  const t = String(text || '').trim();
  const m = MARKS_TAIL.exec(t);
  if (!m) return { text: t, marks: '' };
  return { text: t.slice(0, m.index).trim(), marks: toLatinDigits(m[1] || m[2] || '') };
}

// "CUI = Character User Interface": the abbreviation is the question, the rest its answer.
// Maths ("AB = 5 cm", "x + 5 = 12", "2 + 3 = ____") is never split.
const FULL_FORM = /^([A-Z][A-Z0-9.&/-]{1,14})\s*=\s*([^_=0-9\u0966-\u096F]*[A-Za-z][^_=0-9\u0966-\u096F]*)$/;

// "1.BREH____ 2. TEER____" -> two items. Only splits on the next expected number.
function splitItems(line) {
  const first = ITEM_START.exec(line);
  if (!first) return null;
  const items = [];
  let label = first[1];
  let rest = line.slice(first[0].length);
  for (;;) {
    const n = Number(toLatinDigits(label));
    if (!Number.isInteger(n)) break;
    const next = /[\u0966-\u096F]/.test(label) ? toDevanagariDigits(String(n + 1)) : String(n + 1);
    const re = new RegExp(`\\s(\\(?${next}\\s*(?:[)\\]]|\\.(?![0-9]))\\s*)(?=\\S)`);
    const m = re.exec(rest);
    if (!m) break;
    items.push({ label, text: rest.slice(0, m.index).trim() });
    label = next;
    rest = rest.slice(m.index + m[0].length);
  }
  items.push({ label, text: rest.trim() });
  return items;
}

// "(क) अग्नि   (ख) जल   (ग) पवन" or "(a) Heart (b) Lungs" under a sub-question: its choices.
function splitOptions(line) {
  if (!/^\s*\(/.test(line)) return null;
  const parts = [...line.matchAll(/\(\s*([^()\s]{1,3})\s*\)\s*([^()]*?)\s*(?=\(\s*[^()\s]{1,3}\s*\)|$)/g)];
  if (parts.length < 2 || labelNumbers(parts.map((p) => p[1])).some((n, i) => n !== i + 1)) return null;
  return parts.map((p) => p[2].replace(/\s*_{3,}\s*$/, '').trim()).filter(Boolean);
}

// Basic OCR reads printed blanks ("______") as a run of spaces, often followed by
// one or two junk characters where the line ended, and reads "I" as "|".
function cleanOcrLine(raw) {
  return String(raw || '')
    .replace(/\s+$/, '')
    .replace(/\s{4,}[^\s\w]{0,2}\w?\s*$/, ' ______')
    .replace(/([^\s_])\s{4,}(?=\S)/g, '$1 ______ ')
    .replace(/^(\d{1,2})(?=[A-Z]{3,}_)/, '$1.')
    .replace(/(^|[\s.])\|(?=\s?[A-Za-z])\s*/g, '$1I ')
    .trim();
}

const isSectionTitle = (line) =>
  (/^[A-Z][A-Z &/\-]{2,40}$/.test(line) && line.split(/\s+/).length <= 4 && !/^(ANS|Q\d)/.test(line)) ||
  /^(?:विभाग|खंड|भाग)\s*[-–:]?\s*[\u0900-\u097F0-9A-Za-z]{1,3}\s*$/.test(line);

// Junk lines from basic OCR have almost no letters; short sums ("5 + 4 =") are kept.
const isContentLine = (l) =>
  l.replace(/[^\p{L}\p{M}\p{N}]/gu, '').length >= 3 || /[0-9\u0966-\u096F]\s*[+\-−×÷*/=]/.test(l);

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
    .filter((l) => l && !NOISE.test(l) && isContentLine(l));
  // Upper-case lines above the first question are usually the school header;
  // only the one directly above it can be a section title.
  const firstQuestion = lines.findIndex((l) => QUESTION_PREFIX.test(l) && QUESTION_LINE.test(l));

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
    if (m && (QUESTION_PREFIX.test(line) || m[2])) {
      const { text: qText, marks } = splitMarks(m[2]);
      // Marks printed far to the right leave a run of spaces that reads like a blank.
      newQuestion({ number: m[1], text: qText.replace(/\s*_{3,}$/, ''), marks });
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

    const options = item && lastKind === 'item' ? splitOptions(line) : null;
    if (options) {
      item.options = options;
      continue;
    }

    const parts = splitItems(line);
    if (parts) {
      if (!question) newQuestion({});
      for (const part of parts) {
        const full = FULL_FORM.exec(part.text);
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

// Letters and digits of any script; drops brackets, dots and the danda (।).
const cleanLabel = (v) => str(v).replace(/[^0-9A-Za-z\u0900-\u0963\u0966-\u096F\u0971-\u097F]/g, '');
const LEADING_LABEL = new RegExp(`^\\(?(${LABEL})\\s*(?:[)\\]]|\\.(?![0-9]))\\s*`);
// Labels the model sometimes leaves on options: "(क) अग्नि", "(१) रात्र", "(a) Heart".
const OPTION_LABEL = new RegExp(`^\\(?(?:${LABEL})\\s*(?:[)\\]]|\\.(?![0-9]))\\s*(?=\\S)`);

function normalizeItem(raw) {
  const it = raw && typeof raw === 'object' ? raw : { text: raw };
  let label = cleanLabel(it.label);
  let text = str(it.text);
  if (!label) {
    const m = LEADING_LABEL.exec(text);
    if (m && text.length > m[0].length) {
      label = m[1];
      text = text.slice(m[0].length);
    }
  }
  let options = (Array.isArray(it.options) ? it.options : [])
    .map((o) => str(o).replace(OPTION_LABEL, ''))
    .filter(Boolean)
    .slice(0, 10);
  // Choices already written inside the sentence ("(Sapota / Egg) comes from a tree") are not repeated below it.
  const flat = (v) => v.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (options.length && options.every((o) => flat(o) && flat(text).includes(flat(o)))) options = [];
  let answer = str(it.answer);
  const fullForm = FULL_FORM.exec(text);
  if (fullForm && !answer) {
    text = fullForm[1];
    answer = fullForm[2].trim();
  }
  return { label, text, options, answer };
}

const MATCH_PAIRS = /match\s+the|match\s+(the\s+)?(following|pairs|columns)|जोड़ी\s*मिलाइए|जोड़ियाँ\s*मिलाइए|जोड़े\s*मिलाइए|जोड्या\s*(जुळवा|लावा)/i;

function normalizeQuestion(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const number = cleanLabel(
    str(q.number)
      .replace(/^(?:Q(?:ue(?:s(?:tion)?)?)?|प्रश्न|प्र)\s*\.?\s*(?:no\.?\s*|क्र(?:मांक)?\.?\s*)?/i, '')
      .replace(/([0-9\u0966-\u096F]+)\s*(?:ला|रा|था|वा)$/, '$1'),
  );
  let text = str(q.text).replace(
    /^(?:Q(?:ue(?:s(?:tion)?)?)?|प्रश्न|प्र)\s*\.?\s*[0-9\u0966-\u096F]{1,3}\s*(?:(?:ला|रा|था|वा)(?![\u0900-\u097F]))?\s*[.):\]\-–]*\s*/i,
    '',
  );
  let marks = toLatinDigits(str(q.marks));
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
  // "Match the following" read as sub-questions with one "option" each: those are the table's rows.
  if (!headers.length && !rows.length && items.length >= 2 && MATCH_PAIRS.test(text) && items.every((i) => i.options.length === 1)) {
    rows = items.map((i) => [i.label ? `${i.label}) ${i.text}` : i.text, i.options[0]]);
    items.length = 0;
  }
  // "Classify …" followed by a single line of column titles ("Material Written Oral"):
  // that line is the header of a blank table, not a sub-question.
  if (
    !headers.length &&
    !rows.length &&
    items.length === 1 &&
    !items[0].label &&
    /classif|categori|sort|group|arrange|वर्गीकरण|वर्गीकृत|वर्गवारी|गटात/i.test(text)
  ) {
    const cells = items[0].text.includes('|')
      ? items[0].text.split('|').map((c) => c.trim()).filter(Boolean)
      : items[0].text.split(/\s+/);
    const heading = (c) => /^[A-Z][\w -]{0,30}$/.test(c) || /^[\u0904-\u0939][\u0900-\u097F -]{0,30}$/.test(c);
    if (cells.length >= 2 && cells.length <= 6 && cells.every(heading)) {
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

const SEP = '\\s*[:\\-–.]*\\s*';
const HEADER_FIELDS = [
  { key: 'subject', re: new RegExp(`^((?:subject\\s*(?:name)?|विषय)${SEP})(.*)$`, 'i') },
  { key: 'className', re: new RegExp(`^((?:(?:std|standard|class|grade)\\.?|कक्षा|इयत्ता|वर्ग)${SEP})(.*)$`, 'i') },
  {
    key: 'totalMarks',
    re: new RegExp(`^((?:(?:total\\s*|max(?:imum)?\\.?\\s*)?marks?|पूर्णांक|कुल\\s*अंक|पूर्ण\\s*गुण|एकूण\\s*गुण|अंक|गुण)${SEP})(.*)$`, 'i'),
  },
  { key: 'time', re: new RegExp(`^((?:time|duration|समय|अवधि|वेळ|कालावधी)${SEP})(.*)$`, 'i') },
  { key: 'date', re: new RegExp(`^((?:date|दिनांक|तारीख)${SEP})(.*)$`, 'i') },
];

function fillSegment(segment, values) {
  const lead = /^\s*/.exec(segment)[0];
  const trail = /\s*$/.exec(segment.slice(lead.length))[0];
  const core = segment.slice(lead.length, segment.length - trail.length);
  for (const field of HEADER_FIELDS) {
    const m = field.re.exec(core);
    if (m && values[field.key]) return lead + m[1] + (/[:\-–.]$/.test(m[1]) ? ' ' : '') + values[field.key] + trail;
  }
  return segment;
}

// Template header cells with "Subject:-", "Std:-", "Marks:", "विषय :", "इयत्ता :", "गुण :" etc.
// filled from the photo, with digits written the way the format writes them.
export function buildHeaderLines(profile, content) {
  const values = { ...content.meta };
  if (!values.totalMarks) values.totalMarks = totalMarks(content);
  const digits = profile.digits === 'devanagari' ? toDevanagariDigits : toLatinDigits;
  for (const key of Object.keys(values)) values[key] = digits(values[key] || '');
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

// Diagrams are not reproduced (yet): "[Diagram]" markers from the OCR step are removed
// and the teacher is told which questions had one.
const DIAGRAM = /\[\s*(?:diagram|figure|fig\.?|picture|graph|image|आकृती|आकृति|चित्र)[^\]]*\]/gi;

export function stripDiagrams(content) {
  const where = [];
  const strip = (v) => {
    const before = String(v ?? '');
    const after = before.replace(DIAGRAM, ' ').replace(/\s+/g, ' ').trim();
    return { value: after, found: after !== before.replace(/\s+/g, ' ').trim() };
  };
  for (const section of content.sections || []) {
    let counter = 0;
    for (const q of section.questions || []) {
      if (q.text || q.number) counter += 1;
      let found = false;
      for (const key of ['text', 'note']) {
        const r = strip(q[key]);
        q[key] = r.value;
        found = found || r.found;
      }
      for (const item of q.items || []) {
        const r = strip(item.text);
        item.text = r.value;
        found = found || r.found;
      }
      if (found) where.push(q.number || String(counter || 1));
    }
  }
  if (!where.length) return { content, warning: null };
  const list = [...new Set(where)].join(', ');
  return {
    content: normalizeContent(content),
    warning: `Diagrams were left out (question ${list}). If a question needs its diagram, add it to the Excel file by hand.`,
  };
}

export async function structureText(text, { onWait, language = 'en' } = {}) {
  const warnings = [];
  const finish = (content, method) => {
    const { content: clean, warning } = stripDiagrams(content);
    return { content: clean, method, warnings: warning ? [...warnings, warning] : warnings };
  };
  if (groqEnabled()) {
    try {
      const raw = await structureWithGroq(text, { onWait, language });
      const content = normalizeContent(raw);
      if (content.sections.some((s) => s.questions.length)) return finish(content, 'groq');
      warnings.push('The AI found no questions; used built-in rules instead.');
    } catch (err) {
      warnings.push(`AI structuring failed (${err.message}); used built-in rules instead. Please review the questions.`);
    }
  }
  return finish(normalizeContent(parseWithRules(text)), 'rules');
}
