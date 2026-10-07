// Converts a worksheet into a small JSON model the React preview can draw
// (cells, styles, column widths, row heights, merges and print settings).
import ExcelJS from 'exceljs';
import { cellText } from '../utils/excel.js';

const argbToHex = (color) => {
  const argb = color?.argb;
  if (!argb || typeof argb !== 'string' || argb.length < 6) return null;
  const hex = argb.slice(-6);
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
};

function parseArea(area) {
  const m = /([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/i.exec(String(area || '').replace(/\$/g, ''));
  if (!m) return null;
  const toIndex = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { lastCol: toIndex(m[3]), lastRow: Number(m[4]) };
}

export function renderWorksheet(ws, { maxRows = 1000, maxCols = 40 } = {}) {
  const props = ws.properties || {};
  const defaultRowHeight = props.defaultRowHeight || 15;
  const defaultColWidth = props.defaultColWidth || 8.43;
  const area = parseArea(ws.pageSetup?.printArea);

  const rowLimit = Math.min(ws.rowCount || 0, maxRows);
  const colLimit = Math.min(Math.max(ws.columnCount || 1, area?.lastCol || 1), maxCols);

  const styles = [];
  const styleIndex = new Map();
  const styleOf = (cell) => {
    const f = cell.font || {};
    const a = cell.alignment || {};
    const b = cell.border || {};
    const fill = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? argbToHex(cell.fill.fgColor) : null;
    const s = {
      n: f.name || null,
      sz: f.size || null,
      b: f.bold ? 1 : 0,
      i: f.italic ? 1 : 0,
      u: f.underline ? 1 : 0,
      st: f.strike ? 1 : 0,
      c: argbToHex(f.color),
      h: a.horizontal || null,
      v: a.vertical || null,
      w: a.wrapText ? 1 : 0,
      in: a.indent || 0,
      bt: b.top?.style || null,
      bl: b.left?.style || null,
      bb: b.bottom?.style || null,
      br: b.right?.style || null,
      bg: fill,
    };
    const key = JSON.stringify(s);
    if (!styleIndex.has(key)) {
      styleIndex.set(key, styles.length);
      styles.push(s);
    }
    return styleIndex.get(key);
  };

  const merges = Object.values(ws._merges || {}).map((r) => ({ top: r.top, left: r.left, bottom: r.bottom, right: r.right }));
  const mergedSlaves = new Set();
  for (const m of merges) {
    for (let r = m.top; r <= m.bottom; r += 1) {
      for (let c = m.left; c <= m.right; c += 1) if (r !== m.top || c !== m.left) mergedSlaves.add(`${r}:${c}`);
    }
  }

  const rows = [];
  let lastRow = 0;
  let lastCol = 1;
  for (let r = 1; r <= rowLimit; r += 1) {
    const row = ws.findRow(r);
    if (!row) continue;
    const cells = [];
    for (let c = 1; c <= colLimit; c += 1) {
      if (mergedSlaves.has(`${r}:${c}`)) continue;
      const cell = ws.findCell(r, c);
      if (!cell) continue;
      const text = cellText(cell);
      const border = cell.border || {};
      const hasBorder = ['top', 'left', 'bottom', 'right'].some((k) => border[k]?.style);
      const hasFill = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid';
      if (!text && !hasBorder && !hasFill) continue;
      cells.push({ c, t: text, s: styleOf(cell) });
      lastCol = Math.max(lastCol, c);
    }
    if (cells.length || row.height) rows.push({ r, h: row.height || null, cells });
    if (cells.length) lastRow = r;
  }

  if (area) {
    lastRow = Math.max(lastRow, area.lastRow);
    lastCol = Math.max(lastCol, area.lastCol);
  }

  const columns = [];
  for (let c = 1; c <= lastCol; c += 1) {
    const col = ws.getColumn(c);
    columns.push({ w: col.hidden ? 0 : col.width || defaultColWidth });
  }

  const ps = ws.pageSetup || {};
  return {
    sheetName: ws.name,
    lastRow,
    lastCol,
    defaultRowHeight,
    columns,
    rows: rows.filter((row) => row.r <= lastRow),
    styles,
    merges,
    page: {
      orientation: ps.orientation || 'portrait',
      paperSize: ps.paperSize || 9,
      fitToWidth: Boolean(ps.fitToPage) && (ps.fitToWidth ?? 1) >= 1,
      horizontalCentered: Boolean(ps.horizontalCentered),
      margins: ps.margins || { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 },
    },
  };
}

export async function renderBuffer(buffer, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets[0];
  return renderWorksheet(ws);
}
