// Builds the output .xlsx: opens the saved template, keeps its header block,
// clears everything below it and writes the new questions using the styles,
// columns and spacing learned by templateAnalyzer.js.
import ExcelJS from 'exceljs';
import { applyStyle, colLetter } from '../utils/excel.js';
import { formatNumber, labelToNumber, toAlpha } from '../utils/numbering.js';
import { readDefaultFont, restoreDefaultFont } from '../utils/xlsxPatch.js';

function removeOtherSheets(wb, keep) {
  for (const ws of [...wb.worksheets]) {
    if (ws.id !== keep.id) wb.removeWorksheet(ws.id);
  }
  const quoted = new RegExp(`^'?${keep.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?!`);
  try {
    wb.definedNames.model = (wb.definedNames.model || []).filter((dn) =>
      (dn.ranges || []).every((r) => quoted.test(r)),
    );
  } catch {
    /* defined names are optional */
  }
}

function clearBelow(ws, endRow) {
  for (const range of Object.values(ws._merges || {})) {
    if (range.top > endRow) ws.unMergeCells(range.top, range.left, range.bottom, range.right);
  }
  // spliceRows() leaves stale cells behind, so drop the row objects directly.
  if (Array.isArray(ws._rows) && ws._rows.length > endRow) ws._rows.length = endRow;
  if (Array.isArray(ws._media)) {
    ws._media = ws._media.filter((m) => m.type !== 'image' || (m.range?.tl?.nativeRow ?? 0) < endRow);
  }
  ws.pageSetup.printArea = undefined;
}

function applyHeader(ws, profile, headerLines) {
  if (!Array.isArray(headerLines)) return;
  const allowed = new Set((profile.header.cells || []).map((c) => c.address));
  for (const line of headerLines) {
    if (!line || !allowed.has(line.address)) continue;
    const cell = ws.getCell(line.address);
    const text = String(line.text ?? '');
    if (text !== String(cell.text ?? '')) cell.value = text || null;
  }
}

function wrapWords(text, firstCap, restCap) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  let cap = Math.max(10, firstCap);
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (!cur || candidate.length <= cap) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
      cap = Math.max(10, restCap);
    }
  }
  lines.push(cur);
  return lines;
}

const numericMarks = (marks) => {
  const m = /\d+(?:\.\d+)?/.exec(String(marks || ''));
  return m ? m[0] : String(marks || '').trim();
};

class SheetWriter {
  constructor(ws, profile) {
    this.ws = ws;
    this.p = profile;
    this.last = profile.header.endRow || 0;
    this.started = false;
    this.maxCol = 1;
  }

  colWidth(col) {
    const c = (this.p.columns || []).find((x) => x.index === col);
    return c?.width || this.p.defaultColWidth || 8.43;
  }

  units(fromCol, toCol) {
    let total = 0;
    for (let c = fromCol; c <= toCol; c += 1) total += this.colWidth(c);
    return total;
  }

  get lastTextCol() {
    const { marks, item, lastCol } = this.p;
    if (marks.col && marks.col > item.col) return marks.col - 1;
    return Math.max(lastCol || 1, item.col);
  }

  // How many characters fit on a line that starts in `col`.
  capacity(col) {
    const cpu = this.p.wrap?.charsPerUnit || 1.15;
    const fixed = this.p.wrap?.maxChars;
    if (fixed) return Math.max(20, fixed - Math.round(cpu * this.units(this.p.item.col, col - 1)));
    return Math.max(20, Math.floor(cpu * this.units(col, this.lastTextCol)));
  }

  nextRow(gap) {
    if (!this.started) {
      this.started = true;
      return this.last + 1 + (this.p.spacing.afterHeader ?? 1);
    }
    return this.last + 1 + gap;
  }

  put(row, col, text, style, height) {
    const cell = this.ws.getCell(row, col);
    cell.value = text === '' || text === null || text === undefined ? null : text;
    const fallbackFont = this.p.defaultFont || { name: this.p.baseFont?.name, size: this.p.baseFont?.size };
    applyStyle(cell, style?.font ? style : { ...style, font: fallbackFont });
    if (height) this.ws.getRow(row).height = height;
    this.last = Math.max(this.last, row);
    this.maxCol = Math.max(this.maxCol, col);
  }

  // Writes `prefix + body`, wrapping long text onto continuation rows.
  putWrapped(row, { col, prefix, body, style, contCol, contIndent, contStyle, height }) {
    const lines = wrapWords(body, this.capacity(col) - prefix.length, this.capacity(contCol) - contIndent);
    this.put(row, col, prefix + lines[0], style, height);
    lines.slice(1).forEach((line, i) => this.put(row + 1 + i, contCol, ' '.repeat(contIndent) + line, contStyle));
    return row + lines.length - 1;
  }
}

// Question types where students write a short answer on the paper itself.
const KINDS = [
  ['fullform', /full[\s-]*forms?|abbreviat|expand the/i],
  ['fill', /fill\s*(in|up)|blanks?\b/i],
  ['truefalse', /true\s*(or|\/|and)\s*false|right\s*or\s*wrong|correct\s*or\s*(incorrect|wrong)|yes\s*or\s*no/i],
  ['oneword', /one[\s-]*word|single[\s-]*word/i],
  ['long', /define|explain|describe|answer\s+in\s+(brief|detail|short)|long\s+answer|why\b|differen/i],
];
const questionKind = (text) => KINDS.find(([, re]) => re.test(text || ''))?.[0] || 'other';

// Where the answer is written on the paper: returns how to show the blank for this
// question's items when they have none – 'equals' ("CUI = ____"), 'end' ("… ____") or null.
function blankStyle(q, profile, includeAnswers) {
  if (profile.answerLines === false) return null;
  const items = q.items || [];
  const kind = questionKind(q.text);
  const answers = items.map((i) => String(i.answer || '').trim()).filter(Boolean);
  if (includeAnswers && answers.length) return null;
  if (kind === 'fullform') return 'equals';
  if (['fill', 'truefalse', 'oneword'].includes(kind)) return 'end';
  if (kind === 'long' || answers.some((a) => a.length > 60)) return null;
  return answers.length ? 'end' : null;
}

export function writeBody(ws, profile, content, { includeAnswers = false } = {}) {
  const p = profile;
  const w = new SheetWriter(ws, p);
  const blank = (text) => String(text || '').replace(/_{3,}/g, p.blank || '______________').trim();
  const sp = p.spacing;

  for (const section of content.sections || []) {
    let justAfterSection = false;
    const title = String(section.title || '').trim();
    if (title) {
      const row = w.nextRow(sp.beforeSection);
      w.put(row, p.section.col, p.section.uppercase ? title.toUpperCase() : title, p.section.style, p.section.rowHeight);
      justAfterSection = true;
    }

    let qCounter = 0;
    for (const q of section.questions || []) {
      const hasHeading = Boolean(String(q.text || '').trim() || String(q.number || '').trim());
      let childGap = sp.afterQuestion;

      if (hasHeading) {
        const n = labelToNumber(q.number) ?? qCounter + 1;
        qCounter = n;
        const label = p.question.numberFormat.replace('{n}', formatNumber(n, p.question.numberStyle));
        let text = blank(q.text);
        if (p.question.suffix && text && !/[?!:\-–]$/.test(text)) text = text.replace(/[\s.]+$/, '') + p.question.suffix;
        const marks = numericMarks(q.marks);
        if (marks && !p.marks.col) text += p.marks.inlineFormat.replace('{m}', marks);

        const prefix = ' '.repeat(p.question.indent) + label + ' '.repeat(p.question.gap);
        const row = w.nextRow(justAfterSection ? sp.afterSection : sp.betweenQuestions);
        w.putWrapped(row, {
          col: p.question.col,
          prefix,
          body: text,
          style: p.question.style,
          contCol: p.question.col,
          contIndent: prefix.length,
          contStyle: p.question.style,
          height: p.question.rowHeight,
        });
        if (marks && p.marks.col) w.put(row, p.marks.col, p.marks.format.replace('{m}', marks), p.marks.style);
      } else {
        childGap = w.started ? (justAfterSection ? sp.afterSection : sp.betweenQuestions) : 0;
      }
      justAfterSection = false;

      const note = blank(q.note);
      if (note) {
        const row = w.nextRow(childGap);
        w.putWrapped(row, {
          col: p.note.col,
          prefix: ' '.repeat(p.note.indent),
          body: note,
          style: p.note.style,
          contCol: p.note.col,
          contIndent: p.note.indent,
          contStyle: p.note.style,
        });
        childGap = sp.afterQuestion;
      }

      const table = q.table || {};
      const headers = (table.headers || []).map((h) => String(h ?? ''));
      const bodyRows = (table.rows || []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
      const nCols = Math.max(headers.length, ...bodyRows.map((r) => r.length), 0);
      if (nCols) {
        let row = w.nextRow(sp.beforeTable);
        const hasHeaderRow = headers.some((h) => h.trim());
        if (hasHeaderRow) {
          for (let c = 0; c < nCols; c += 1) w.put(row, p.table.col + c, headers[c] || '', p.table.headerStyle);
          row += 1;
        }
        const filled = bodyRows.length ? bodyRows : Array.from({ length: p.table.emptyRows || 4 }, () => []);
        filled.forEach((cells, i) => {
          const style = i === 0 && hasHeaderRow && p.table.firstRowStyle ? p.table.firstRowStyle : p.table.cellStyle;
          for (let c = 0; c < nCols; c += 1) w.put(row, p.table.col + c, blank(cells[c] || ''), style);
          row += 1;
        });
        childGap = sp.beforeTable;
      }

      let iCounter = 0;
      const blankMode = blankStyle(q, p, includeAnswers);
      const blankText = p.blank || '______________';
      (q.items || []).forEach((item, idx) => {
        const n = labelToNumber(item.label) ?? iCounter + 1;
        iCounter = n;
        const label = p.item.numberFormat.replace('{n}', formatNumber(n, p.item.numberStyle));
        const prefix = ' '.repeat(p.item.indent) + label + ' '.repeat(p.item.gap);
        const row = w.nextRow(idx === 0 ? childGap : sp.betweenItems);
        const cont = { contCol: p.continuation.col, contIndent: p.continuation.indent, contStyle: p.continuation.style };
        let body = blank(item.text);
        if (blankMode && body && !/_{3,}/.test(body)) {
          body = blankMode === 'equals' ? `${body.replace(/\s*[:=-]+$/, '')} = ${blankText}` : `${body} ${blankText}`;
        }
        w.putWrapped(row, { col: p.item.col, prefix, body, style: p.item.style, ...cont });

        const options = (item.options || []).map((o) => String(o || '').trim()).filter(Boolean);
        if (options.length) {
          // Keep options on as few lines as possible, breaking only between options.
          const cap = w.capacity(cont.contCol) - cont.contIndent;
          const lines = [];
          options.forEach((o, i) => {
            const part = `(${toAlpha(i + 1).toLowerCase()}) ${o}`;
            const last = lines[lines.length - 1];
            if (last && last.length + 6 + part.length <= cap) lines[lines.length - 1] = `${last}      ${part}`;
            else lines.push(part);
          });
          lines.forEach((line) => w.put(w.last + 1, cont.contCol, ' '.repeat(cont.contIndent) + line, cont.contStyle));
        }
        const answer = String(item.answer || '').trim();
        if (includeAnswers && answer) {
          w.putWrapped(w.last + 1, {
            col: p.answer.col,
            prefix: ' '.repeat(p.answer.indent) + (p.answer.prefix || 'Ans: '),
            body: answer,
            style: p.answer.style,
            contCol: p.answer.col,
            contIndent: p.answer.indent + (p.answer.prefix || 'Ans: ').length,
            contStyle: p.answer.style,
          });
        }
      });
    }
  }
  return { lastRow: w.last, maxCol: w.maxCol };
}

function setupPrint(ws, profile, lastRow, lastCol) {
  const p = profile.print || {};
  Object.assign(ws.pageSetup, {
    paperSize: p.paperSize || 9,
    orientation: p.orientation || 'portrait',
    fitToPage: p.fitToWidth !== false,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: p.horizontalCentered !== false,
    margins: p.margins || ws.pageSetup.margins,
    printArea: `A1:${colLetter(lastCol)}${Math.max(lastRow, 1)}`,
  });
}

export async function buildPaperWorkbook({ templateBuffer, profile, content, includeAnswers = false }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const ws = wb.getWorksheet(profile.sheetName) || wb.worksheets[0];
  if (!ws) throw new Error('Template has no worksheet');

  removeOtherSheets(wb, ws);
  clearBelow(ws, profile.header.endRow || 0);
  applyHeader(ws, profile, content.header);
  const { lastRow, maxCol } = writeBody(ws, profile, content, { includeAnswers });

  const headerCols = (profile.header.cells || []).map((c) => c.col);
  const lastCol = Math.max(profile.lastCol || 1, maxCol, profile.marks.col || 0, ...headerCols);
  setupPrint(ws, profile, lastRow, lastCol);

  wb.creator = 'Image to Excel';
  wb.lastModifiedBy = 'Image to Excel';
  wb.modified = new Date();

  const raw = Buffer.from(await wb.xlsx.writeBuffer());
  const buffer = await restoreDefaultFont(raw, (await readDefaultFont(templateBuffer))?.xml);
  return { workbook: wb, worksheet: ws, buffer, lastRow, lastCol };
}
