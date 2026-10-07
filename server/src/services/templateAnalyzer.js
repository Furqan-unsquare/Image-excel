// Reads an uploaded Excel question paper and learns its layout: where the
// header ends, which column/style section titles, question headings, marks,
// sub-questions and wrapped lines use, how many blank rows separate them, etc.
// The result ("profile") drives services/excelGenerator.js.
import ExcelJS from 'exceljs';
import { config, groqEnabled } from '../config.js';
import { groqJSON } from './groq.js';
import { cellText, clone, colLetter, hasBorder, pickStyle, styleSignature } from '../utils/excel.js';
import { detectNumberStyle } from '../utils/numbering.js';
import { httpError } from '../utils/http.js';
import { readDefaultFont } from '../utils/xlsxPatch.js';

const MAX_ROWS = 800;
const MAX_COLS = 40;
const DEFAULT_COL_WIDTH = 8.43;

export const ROLES = ['header', 'section', 'question', 'item', 'continuation', 'note', 'answer', 'table', 'other'];

// "Q1.  Fill in…", "Que 4) …", "Question 2 - …", "Q. IV …"
const QUESTION_RE = /^(\s*)(Q(?:ue(?:s(?:tion)?)?)?\s*\.?\s*(?:no\.?\s*)?)(\d{1,3}|[IVX]{1,5})(?![A-Za-z0-9])(\s*[.):\]\-–]*)(\s*)([\s\S]*)$/i;
// "1.  The calendar…", "(a) …", "iv) …", "B. …", "6] …"
const ITEM_RE = /^(\s*)(\(?)(\d{1,2}|[ivx]{1,4}|[IVX]{1,4}|[A-Za-z])(\s*(?:[.)\]]|:-?))(\s*)([\s\S]*)$/;
// "[ 2 M]", "(5 Marks)", "3 marks", "[2M]"
export const MARKS_RE = /^\s*(?:[[(]\s*\d+(?:\.\d+)?\s*(?:m|mk|mks|marks?|mark'?s)?\.?\s*[\])]|\d+(?:\.\d+)?\s*(?:m|mk|mks|marks?|mark'?s)\.?)\s*$/i;
const BARE_NUMBER_RE = /^\s*\d+(?:\.\d+)?\s*$/;
const ANSWER_RE = /^\s*ans(?:wer)?\s*[\].:)\-–]/i;
const SUFFIX_RE = /(\s*(?::-|:–|:|–|-))\s*$/;

function parseQuestion(text) {
  const m = QUESTION_RE.exec(text);
  if (!m) return null;
  return { indent: m[1].length, prefix: m[2], token: m[3], punct: m[4].trim(), gap: m[5].length, rest: m[6] };
}

function parseItem(text) {
  const m = ITEM_RE.exec(text);
  if (!m) return null;
  return { indent: m[1].length, prefix: m[2], token: m[3], punct: m[4].trim(), gap: m[5].length, rest: m[6] };
}

function mode(values, fallback = null) {
  const counts = new Map();
  let best = fallback;
  let bestCount = 0;
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const key = typeof v === 'object' ? JSON.stringify(v) : v;
    const entry = counts.get(key) || { value: v, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
    if (entry.count > bestCount) {
      bestCount = entry.count;
      best = entry.value;
    }
  }
  return best;
}

// The style used by most of the given cells (first cell of the winning signature).
function modeStyle(cells, fallback = {}) {
  if (!cells.length) return clone(fallback);
  const sig = mode(cells.map((c) => styleSignature(c.style)));
  const cell = cells.find((c) => styleSignature(c.style) === sig) || cells[0];
  const style = clone(cell.style);
  delete style.border;
  delete style.fill;
  return style;
}

const isUpper = (text) => /[A-Z]/.test(text) && text === text.toUpperCase();

function pickSheet(wb) {
  let best = null;
  let bestCount = -1;
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    let count = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, () => {
        count += 1;
      });
    });
    if (count > bestCount) {
      best = ws;
      bestCount = count;
    }
  });
  return best;
}

function collectRows(ws, defaultFont) {
  const lastRow = Math.min(ws.rowCount || 0, MAX_ROWS);
  const lastCol = Math.min(Math.max(ws.columnCount || 0, 1), MAX_COLS);
  const rows = [];
  for (let r = 1; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
      const text = cellText(cell);
      const bordered = hasBorder(cell.border);
      if (!text.trim() && !bordered) continue;
      const style = pickStyle(cell);
      // Cells on the workbook's default style come back without a font.
      if (!style.font && defaultFont) style.font = clone(defaultFont);
      cells.push({ row: r, col: c, address: cell.address, text, bordered, style });
    }
    if (cells.length) rows.push({ row: r, cells, height: row.height || null });
  }
  return rows;
}

function describeRow(r) {
  const textCells = r.cells.filter((c) => c.text.trim());
  const borderedCount = r.cells.filter((c) => c.bordered).length;
  const primaryCandidates = textCells.filter((c) => !(c !== textCells[0] && MARKS_RE.test(c.text)));
  const primary = primaryCandidates[0] || textCells[0] || null;
  let marksCell = textCells.find((c) => c !== primary && MARKS_RE.test(c.text)) || null;
  const info = { row: r.row, primary, marksCell, textCells, borderedCount, parsed: null, role: 'other' };
  if (!primary) {
    info.role = borderedCount ? 'table' : 'other';
    return info;
  }
  if (borderedCount >= 2) {
    info.role = 'table';
    return info;
  }
  const q = parseQuestion(primary.text);
  if (q) {
    if (!marksCell) marksCell = textCells.find((c) => c !== primary && BARE_NUMBER_RE.test(c.text)) || null;
    Object.assign(info, { role: 'question', parsed: q, marksCell });
    return info;
  }
  const it = parseItem(primary.text);
  if (it) {
    Object.assign(info, { role: marksCell ? 'question' : 'item', parsed: it });
    return info;
  }
  if (ANSWER_RE.test(primary.text)) info.role = 'answer';
  else if (marksCell && primary.style.font?.bold) info.role = 'question';
  else info.role = 'text';
  return info;
}

function sectionLike(info, baseSize) {
  if (info.role !== 'text' || !info.primary || info.textCells.length !== 1) return false;
  const text = info.primary.text.trim();
  const font = info.primary.style.font || {};
  if (!text || text.length > 40 || !font.bold) return false;
  return Boolean(font.underline) || (font.size || baseSize) > baseSize || isUpper(text);
}

function baseFontOf(rows) {
  const fonts = rows.flatMap((r) => r.cells.filter((c) => c.text.trim()).map((c) => c.style.font || {}));
  return {
    name: mode(fonts.map((f) => f.name), 'Calibri'),
    size: mode(fonts.map((f) => f.size), 11),
  };
}

// Built-in rules. Works for most papers that use "Q1." headings and "1." items.
function labelHeuristic(rows) {
  const base = baseFontOf(rows);
  const infos = rows.map(describeRow);

  if (!infos.some((i) => i.role === 'question')) {
    // Papers without "Q" prefixes: bold numbered lines are headings, plain ones are items.
    const numbered = infos.filter((i) => i.role === 'item');
    const bold = numbered.filter((i) => i.primary.style.font?.bold);
    if (bold.length && bold.length < numbered.length) bold.forEach((i) => (i.role = 'question'));
  }

  const firstQuestion = infos.find((i) => i.role === 'question') || infos.find((i) => i.role === 'item');
  if (!firstQuestion) {
    infos.forEach((i) => (i.role = i.role === 'table' ? 'table' : 'header'));
    return infos;
  }

  const bodySections = infos.filter((i) => i.row > firstQuestion.row && sectionLike(i, base.size));
  bodySections.forEach((i) => (i.role = 'section'));
  const sectionSigs = new Set(bodySections.map((i) => styleSignature(i.primary.style)));

  let firstBodyRow = firstQuestion.row;
  const before = infos.filter((i) => i.row < firstQuestion.row && i.primary);
  const nearest = before[before.length - 1];
  if (nearest && sectionLike(nearest, base.size)) {
    const font = nearest.primary.style.font || {};
    const matches = sectionSigs.size
      ? sectionSigs.has(styleSignature(nearest.primary.style))
      : Boolean(font.underline) || (font.size || base.size) > base.size;
    if (matches) {
      nearest.role = 'section';
      firstBodyRow = nearest.row;
    }
  }

  let prev = null;
  for (const info of infos) {
    if (info.row < firstBodyRow) {
      info.role = 'header';
      continue;
    }
    if (info.role === 'text' || info.role === 'other') {
      const adjacent = prev && info.row === prev.row + 1;
      if (prev && adjacent && ['item', 'continuation', 'answer'].includes(prev.role)) info.role = 'continuation';
      else info.role = 'note';
    }
    prev = info;
  }
  return infos;
}

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'role'],
        properties: { row: { type: 'integer' }, role: { type: 'string', enum: ROLES } },
      },
    },
  },
};

// AI fallback for unusual layouts the rules above cannot read.
async function labelWithLlm(rows) {
  const flags = (c) => {
    const f = c.style.font || {};
    const parts = [f.bold && 'bold', f.italic && 'italic', f.underline && 'underline', f.size && `${f.size}pt`, c.bordered && 'border'];
    return parts.filter(Boolean).join(',');
  };
  const listing = rows
    .slice(0, 300)
    .map((r) => {
      const cells = r.cells.map((c) => `${colLetter(c.col)}=${JSON.stringify(c.text.slice(0, 90))}${flags(c) ? ` [${flags(c)}]` : ''}`);
      return `row ${r.row}: ${cells.join(' | ')}`;
    })
    .join('\n');

  const result = await groqJSON({
    model: config.groq.textModel,
    reasoningEffort: 'low',
    schema: LABEL_SCHEMA,
    schemaName: 'row_roles',
    messages: [
      {
        role: 'system',
        content:
          'You label the rows of an Excel exam question paper template. Reply with JSON only: {"rows":[{"row":<number>,"role":<role>}]} with one entry per row listed.\n' +
          'Roles:\n' +
          '- header: school name, exam name, subject, class, date, time, total marks lines at the top.\n' +
          '- section: subject or part titles inside the paper (e.g. HISTORY, Section A, Part II).\n' +
          '- question: a main question heading / instruction (e.g. "Q1. Fill in the blanks", "I. Answer the following"), usually bold, often with marks.\n' +
          '- item: a numbered sub-question under a heading ("1. …", "a) …").\n' +
          '- continuation: a line that continues the previous sub-question text.\n' +
          '- note: extra text under a heading that is not a numbered sub-question (word bank, instructions).\n' +
          '- answer: an answer line.\n' +
          '- table: rows of a bordered table/grid.\n' +
          '- other: anything else.',
      },
      { role: 'user', content: listing },
    ],
  });

  const byRow = new Map();
  for (const entry of result?.rows || []) {
    if (ROLES.includes(entry.role)) byRow.set(Number(entry.row), entry.role);
  }
  if (!byRow.size) throw new Error('empty labelling');

  return rows.map((r) => {
    const info = describeRow(r);
    const role = byRow.get(r.row);
    if (role) info.role = role;
    if (info.role === 'question' && !info.parsed) info.parsed = parseQuestion(info.primary?.text || '') || parseItem(info.primary?.text || '');
    if (info.role === 'item' && !info.parsed) info.parsed = parseItem(info.primary?.text || '') || parseQuestion(info.primary?.text || '');
    if (info.role !== 'question') info.marksCell = null;
    return info;
  });
}

function numberFormatOf(parsedList, fallback) {
  if (!parsedList.length) return fallback;
  const prefix = mode(parsedList.map((p) => p.prefix), '');
  const punct = mode(parsedList.map((p) => p.punct), '.');
  return {
    numberFormat: `${prefix}{n}${punct}`,
    numberStyle: mode(parsedList.map((p) => detectNumberStyle(p.token)), 'arabic'),
    indent: mode(parsedList.map((p) => p.indent), 0),
    gap: Math.max(1, mode(parsedList.filter((p) => p.rest.trim()).map((p) => p.gap), 2)),
  };
}

function leadingSpaces(text) {
  return (/^\s*/.exec(text) || [''])[0].length;
}

export const PROFILE_VERSION = 2;

// What to do when a photo has no marks for a question, learned from the format:
// the same marks on every question ("[ 2 M]" everywhere) -> 'fixed', marks equal to
// the number of sub-questions -> 'per-item', no marks in the format -> 'none'.
export function marksRule(questions, infos) {
  const samples = questions
    .filter((q) => q.marksCell)
    .map((q) => {
      const next = infos.find((i) => i.row > q.row && (i.role === 'question' || i.role === 'section'));
      const itemCount = infos.filter((i) => i.role === 'item' && i.row > q.row && (!next || i.row < next.row)).length;
      return { value: Number((/\d+(?:\.\d+)?/.exec(q.marksCell.text) || [])[0]), itemCount };
    })
    .filter((s) => s.value > 0);
  if (!samples.length) return { whenMissing: 'none', defaultValue: 2 };
  const defaultValue = mode(samples.map((s) => s.value), 2);
  const distinct = new Set(samples.map((s) => s.value));
  const withItems = samples.filter((s) => s.itemCount > 0);
  const perItemShare = withItems.length ? withItems.filter((s) => s.value === s.itemCount).length / withItems.length : 0;
  const whenMissing = distinct.size > 1 && perItemShare >= 0.8 ? 'per-item' : 'fixed';
  return { whenMissing, defaultValue };
}

function buildProfile(ws, rows, infos, warnings, defaultFont) {
  const base = baseFontOf(rows);
  const baseStyle = { font: defaultFont ? clone(defaultFont) : { name: base.name, size: base.size } };
  const byRole = (role) => infos.filter((i) => i.role === role && i.primary);
  const heights = new Map(rows.map((r) => [r.row, r.height]));

  // ---- header -------------------------------------------------------------
  const headerInfos = infos.filter((i) => i.role === 'header');
  const bodyInfos = infos.filter((i) => i.role !== 'header');
  const firstBodyRow = bodyInfos.length ? bodyInfos[0].row : null;
  const headerContent = headerInfos.filter((i) => i.primary || i.borderedCount);
  const headerEnd = headerContent.length ? headerContent[headerContent.length - 1].row : 0;
  const headerCells = headerInfos.flatMap((i) =>
    i.textCells.map((c) => ({ address: c.address, row: c.row, col: c.col, text: c.text })),
  );

  // ---- questions + marks --------------------------------------------------
  const questions = byRole('question');
  if (!questions.length) warnings.push('No question headings (like "Q1. Fill in the blanks") were found, so a default layout is used for questions.');
  const qCol = mode(questions.map((i) => i.primary.col), 1);
  const qParsed = questions.map((i) => i.parsed).filter(Boolean);
  const qNumber = numberFormatOf(qParsed, { numberFormat: 'Q{n}.', numberStyle: 'arabic', indent: 0, gap: 3 });
  const qSuffix = mode(
    qParsed.map((p) => {
      const m = SUFFIX_RE.exec(p.rest.replace(/\s+$/, ''));
      return m ? m[1].replace(/^\s+/, ' ') : '';
    }),
    '',
  );
  const qStyle = modeStyle(questions.filter((i) => i.primary.col === qCol).map((i) => i.primary), {
    font: { ...baseStyle.font, bold: true },
  });

  const marksCells = questions.map((i) => i.marksCell).filter(Boolean);
  const marksCol = marksCells.length ? mode(marksCells.map((c) => c.col)) : null;
  const marks = {
    col: marksCol,
    style: modeStyle(marksCells.filter((c) => c.col === marksCol), { font: { ...baseStyle.font, bold: true } }),
    format: mode(marksCells.map((c) => c.text.trim().replace(/\d+(?:\.\d+)?/, '{m}')), '[{m} M]'),
    inlineFormat: ' ({m} Marks)',
  };
  if (marks.format && !marks.format.includes('{m}')) marks.format = '[{m} M]';
  Object.assign(marks, marksRule(questions, infos));

  // ---- sub-questions -----------------------------------------------------
  const items = byRole('item');
  const iCol = mode(items.map((i) => i.primary.col), qCol);
  const iParsed = items.map((i) => i.parsed).filter(Boolean);
  const iNumber = numberFormatOf(iParsed, {
    numberFormat: '{n}.',
    numberStyle: 'arabic',
    indent: qNumber.indent + 2,
    gap: 3,
  });
  const iStyle = modeStyle(items.filter((i) => i.primary.col === iCol).map((i) => i.primary), baseStyle);

  const conts = byRole('continuation');
  const cCol = conts.length ? mode(conts.map((i) => i.primary.col)) : iCol;
  const continuation = {
    col: cCol,
    style: modeStyle(conts.filter((i) => i.primary.col === cCol).map((i) => i.primary), iStyle),
    indent: conts.length
      ? mode(conts.map((i) => leadingSpaces(i.primary.text)), 0)
      : cCol === iCol
        ? iNumber.indent + iNumber.numberFormat.length + iNumber.gap
        : 0,
  };

  const notes = byRole('note');
  const nCol = notes.length ? mode(notes.map((i) => i.primary.col)) : iCol;
  const note = {
    col: nCol,
    style: modeStyle(notes.filter((i) => i.primary.col === nCol).map((i) => i.primary), iStyle),
    indent: notes.length ? mode(notes.map((i) => leadingSpaces(i.primary.text)), iNumber.indent) : iNumber.indent,
  };

  const answers = byRole('answer');
  const answerStyle = answers.length
    ? modeStyle(answers.map((i) => i.primary), iStyle)
    : { ...clone(continuation.style), font: { ...(continuation.style.font || baseStyle.font), italic: true, bold: false } };
  const answer = {
    col: answers.length ? mode(answers.map((i) => i.primary.col)) : continuation.col,
    style: answerStyle,
    indent: answers.length ? mode(answers.map((i) => leadingSpaces(i.primary.text)), 0) : continuation.indent,
    prefix: 'Ans: ',
  };

  // ---- sections ----------------------------------------------------------
  const sections = byRole('section');
  const sCol = sections.length ? mode(sections.map((i) => i.primary.col)) : Math.max(qCol, 3);
  const section = {
    col: sCol,
    style: modeStyle(sections.filter((i) => i.primary.col === sCol).map((i) => i.primary), {
      font: { ...baseStyle.font, size: base.size + 1, bold: true, underline: true },
    }),
    uppercase: sections.length ? sections.every((i) => isUpper(i.primary.text.trim())) : true,
    rowHeight: mode(sections.map((i) => heights.get(i.row)).filter(Boolean), null),
  };

  // ---- tables ------------------------------------------------------------
  const tableRows = infos.filter((i) => i.role === 'table').map((i) => rows.find((r) => r.row === i.row));
  const firstBlock = [];
  for (const r of tableRows) {
    if (!firstBlock.length || r.row === firstBlock[firstBlock.length - 1].row + 1) firstBlock.push(r);
    else break;
  }
  const borderedOf = (r) => (r ? r.cells.filter((c) => c.bordered) : []);
  const headRow = firstBlock[0];
  const table = {
    col: headRow ? Math.min(...borderedOf(headRow).map((c) => c.col)) : Math.max(iCol + 1, 2),
    headerStyle: headRow
      ? clone(borderedOf(headRow)[0].style)
      : {
          font: { ...baseStyle.font, bold: true },
          alignment: { horizontal: 'center' },
          border: { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'medium' } },
        },
    firstRowStyle: firstBlock[1] ? clone(borderedOf(firstBlock[1])[0]?.style || {}) : null,
    cellStyle: firstBlock.length > 1
      ? clone(borderedOf(firstBlock[firstBlock.length - 1])[0]?.style || {})
      : { font: { ...baseStyle.font }, border: { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'thin' } } },
    emptyRows: firstBlock.length > 1 ? firstBlock.length - 1 : 4,
  };

  // ---- spacing (blank rows) ----------------------------------------------
  const lines = [];
  for (const info of bodyInfos) {
    if (!info.primary && info.role !== 'table') continue;
    const last = lines[lines.length - 1];
    if (info.role === 'table' && last?.role === 'table' && last.end === info.row - 1) last.end = info.row;
    else lines.push({ start: info.row, end: info.row, role: info.role });
  }
  const gaps = { afterSection: [], beforeSection: [], afterQuestion: [], betweenItems: [], betweenQuestions: [], beforeTable: [] };
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const cur = lines[i];
    const gap = cur.start - prev.end - 1;
    if (cur.role === 'section') gaps.beforeSection.push(gap);
    else if (prev.role === 'section') gaps.afterSection.push(gap);
    else if (cur.role === 'question') gaps.betweenQuestions.push(gap);
    else if (cur.role === 'table') gaps.beforeTable.push(gap);
    else if (['question', 'note', 'table'].includes(prev.role)) {
      if (cur.role !== 'continuation') gaps.afterQuestion.push(gap);
    } else if (cur.role === 'item') gaps.betweenItems.push(gap);
  }
  const clampGap = (v) => Math.max(0, Math.min(5, v));
  const spacing = {
    afterHeader: firstBodyRow ? clampGap(firstBodyRow - headerEnd - 1) : 1,
    afterSection: clampGap(mode(gaps.afterSection, 1)),
    beforeSection: clampGap(mode(gaps.beforeSection, 1)),
    afterQuestion: clampGap(mode(gaps.afterQuestion, 1)),
    betweenItems: clampGap(mode(gaps.betweenItems, 0)),
    betweenQuestions: clampGap(mode(gaps.betweenQuestions, 1)),
    beforeTable: clampGap(mode(gaps.beforeTable, 1)),
  };

  // ---- columns, wrapping, print -------------------------------------------
  const contentCols = rows.flatMap((r) => r.cells.map((c) => c.col));
  const lastCol = Math.max(marksCol || 0, ...contentCols, 1);
  const columns = [];
  for (let c = 1; c <= Math.max(lastCol, 12); c += 1) {
    const col = ws.getColumn(c);
    columns.push({ index: c, width: col.width || null, hidden: Boolean(col.hidden) });
  }
  const narrow = /narrow|condensed/i.test(base.name || '');
  const charsPerUnit = Number(((narrow ? 1.45 : 1.15) * (11 / (base.size || 11))).toFixed(3));

  const blanks = rows.flatMap((r) => r.cells.flatMap((c) => (c.text.match(/_{3,}/g) || []).map((b) => b.length)));
  const ps = ws.pageSetup || {};

  if (!items.length && questions.length) warnings.push('No numbered sub-questions (like "1. …") were found, so sub-questions use a default style.');

  return {
    version: PROFILE_VERSION,
    sheetName: ws.name,
    baseFont: base,
    defaultFont: baseStyle.font,
    lastCol,
    header: { endRow: headerEnd, cells: headerCells },
    section,
    question: { col: qCol, style: qStyle, ...qNumber, suffix: qSuffix, rowHeight: mode(questions.map((i) => heights.get(i.row)).filter(Boolean), null) },
    marks,
    item: { col: iCol, style: iStyle, ...iNumber },
    continuation,
    note,
    answer,
    table,
    spacing,
    wrap: { charsPerUnit, maxChars: null },
    blank: '_'.repeat(Math.min(30, Math.max(6, mode(blanks, 14)))),
    // Add ______ where students must write (fill in the blanks, true/false, …) when the photo has none.
    answerLines: true,
    columns,
    defaultColWidth: ws.properties?.defaultColWidth || DEFAULT_COL_WIDTH,
    defaultRowHeight: ws.properties?.defaultRowHeight || 15,
    print: {
      paperSize: ps.paperSize || 9,
      orientation: ps.orientation || 'portrait',
      margins: ps.margins ? clone(ps.margins) : { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      fitToWidth: true,
      horizontalCentered: true,
    },
  };
}

export async function analyzeTemplate(buffer, { forceLlm = false, allowLlm = true } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw httpError(400, 'Could not read this Excel file. Please upload a .xlsx file (Excel 2007 or newer).');
  }
  const ws = pickSheet(wb);
  if (!ws) throw httpError(400, 'This Excel file has no visible sheet.');

  const defaultFont = (await readDefaultFont(buffer))?.font || null;
  const rows = collectRows(ws, defaultFont);
  if (!rows.length) throw httpError(400, 'The selected sheet is empty. Upload a sample paper that shows the format.');

  const warnings = [];
  let infos = labelHeuristic(rows);
  let method = 'heuristic';
  const hasQuestions = infos.some((i) => i.role === 'question');

  if ((forceLlm || !hasQuestions) && allowLlm && groqEnabled()) {
    try {
      infos = await labelWithLlm(rows);
      method = 'llm';
    } catch (err) {
      warnings.push(`AI layout detection failed (${err.message}); built-in rules were used instead.`);
    }
  } else if (forceLlm) {
    warnings.push('GROQ_API_KEY is not set, so built-in rules were used.');
  }

  const profile = buildProfile(ws, rows, infos, warnings, defaultFont);
  return { profile, method, warnings, rows: infos.map((i) => ({ row: i.row, role: i.role })) };
}

// Only these profile fields can be edited from the UI.
export function mergeProfileSettings(profile, settings = {}) {
  const next = clone(profile);
  const intOr = (v, fallback, min = 0, max = 50) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const colOr = (v, fallback) => (v === null ? null : intOr(v, fallback, 1, MAX_COLS));
  const str = (v, fallback, max = 40) => (typeof v === 'string' ? v.slice(0, max) : fallback);
  const styles = ['arabic', 'alpha-lower', 'alpha-upper', 'roman-lower', 'roman-upper'];

  if (settings.question) {
    const s = settings.question;
    next.question.col = colOr(s.col, next.question.col);
    next.question.indent = intOr(s.indent, next.question.indent);
    next.question.gap = intOr(s.gap, next.question.gap);
    next.question.numberFormat = str(s.numberFormat, next.question.numberFormat);
    if (!next.question.numberFormat.includes('{n}')) next.question.numberFormat = 'Q{n}.';
    if (styles.includes(s.numberStyle)) next.question.numberStyle = s.numberStyle;
    next.question.suffix = str(s.suffix, next.question.suffix, 10);
    if (s.bold !== undefined) next.question.style.font = { ...(next.question.style.font || {}), bold: Boolean(s.bold) };
    if (s.italic !== undefined) next.question.style.font = { ...(next.question.style.font || {}), italic: Boolean(s.italic) };
  }
  if (settings.marks) {
    const s = settings.marks;
    if (s.col !== undefined) next.marks.col = colOr(s.col, next.marks.col);
    next.marks.format = str(s.format, next.marks.format);
    if (!next.marks.format.includes('{m}')) next.marks.format = '[{m} M]';
    if (['fixed', 'per-item', 'none'].includes(s.whenMissing)) next.marks.whenMissing = s.whenMissing;
    if (s.defaultValue !== undefined) next.marks.defaultValue = intOr(s.defaultValue, next.marks.defaultValue ?? 2, 0, 100);
  }
  if (settings.answerLines !== undefined) next.answerLines = Boolean(settings.answerLines);
  if (settings.item) {
    const s = settings.item;
    next.item.col = colOr(s.col, next.item.col);
    next.item.indent = intOr(s.indent, next.item.indent);
    next.item.gap = intOr(s.gap, next.item.gap);
    next.item.numberFormat = str(s.numberFormat, next.item.numberFormat);
    if (!next.item.numberFormat.includes('{n}')) next.item.numberFormat = '{n}.';
    if (styles.includes(s.numberStyle)) next.item.numberStyle = s.numberStyle;
  }
  if (settings.continuation) {
    next.continuation.col = colOr(settings.continuation.col, next.continuation.col);
    next.continuation.indent = intOr(settings.continuation.indent, next.continuation.indent);
  }
  if (settings.section) {
    next.section.col = colOr(settings.section.col, next.section.col);
    if (settings.section.uppercase !== undefined) next.section.uppercase = Boolean(settings.section.uppercase);
  }
  if (settings.spacing) {
    for (const key of Object.keys(next.spacing)) {
      if (settings.spacing[key] !== undefined) next.spacing[key] = intOr(settings.spacing[key], next.spacing[key], 0, 5);
    }
  }
  if (settings.wrap) {
    const v = settings.wrap.maxChars;
    next.wrap.maxChars = v === null || v === '' || v === undefined ? null : intOr(v, null, 30, 400);
  }
  if (settings.print) {
    if (['portrait', 'landscape'].includes(settings.print.orientation)) next.print.orientation = settings.print.orientation;
  }
  return next;
}
