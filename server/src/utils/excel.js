export function colLetter(index) {
  let n = index;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function colIndex(letters) {
  const s = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '');
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n || null;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const hasBorderSide = (side) => Boolean(side && side.style);

export function hasBorder(border) {
  if (!border) return false;
  return ['top', 'left', 'bottom', 'right'].some((k) => hasBorderSide(border[k]));
}

// A plain, JSON-safe copy of the parts of a cell style we reuse.
export function pickStyle(cell) {
  const style = {};
  if (cell.font && Object.keys(cell.font).length) style.font = clone(cell.font);
  if (cell.alignment && Object.keys(cell.alignment).length) style.alignment = clone(cell.alignment);
  if (hasBorder(cell.border)) style.border = clone(cell.border);
  if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern && cell.fill.pattern !== 'none') {
    style.fill = clone(cell.fill);
  }
  if (cell.numFmt && cell.numFmt !== 'General') style.numFmt = cell.numFmt;
  return style;
}

export function applyStyle(cell, style = {}) {
  if (style.font) cell.font = clone(style.font);
  if (style.alignment) cell.alignment = clone(style.alignment);
  if (style.border) cell.border = clone(style.border);
  if (style.fill) cell.fill = clone(style.fill);
  if (style.numFmt) cell.numFmt = style.numFmt;
}

export function styleSignature(style = {}) {
  const f = style.font || {};
  const a = style.alignment || {};
  return JSON.stringify([f.name || '', f.size || '', !!f.bold, !!f.italic, !!f.underline, a.horizontal || '']);
}

export function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  try {
    return String(cell.text ?? '');
  } catch {
    return String(v);
  }
}

export { clone };
