import { useMemo } from 'react';

// Draws the render model from the API (see server/src/services/sheetRender.js)
// as A4 pages, the way the sheet prints: fit to page width, margins, page breaks.

const PT = 96 / 72;
const A4 = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };
const BORDER_WIDTH = { thin: 1, hair: 1, dotted: 1, dashed: 1, dashDot: 1, dashDotDot: 1, medium: 2, mediumDashed: 2, mediumDashDot: 2, slantDashDot: 2, thick: 3, double: 3 };
const BORDER_STYLE = { dotted: 'dotted', dashed: 'dashed', mediumDashed: 'dashed', dashDot: 'dashed', mediumDashDot: 'dashed', dashDotDot: 'dashed', double: 'double' };

function fontStack(name) {
  const n = String(name || '');
  if (/narrow|condensed/i.test(n)) return `"${n}", "Arial Narrow", "Archivo Narrow", "Roboto Condensed", sans-serif`;
  if (/times|cambria|georgia|serif/i.test(n) && !/sans/i.test(n)) return `"${n}", "Times New Roman", Georgia, serif`;
  if (n) return `"${n}", Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
  return 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
}

const border = (style) => (style ? `${BORDER_WIDTH[style] || 1}px ${BORDER_STYLE[style] || 'solid'} #1f1f1f` : undefined);

export function layoutSheet(model) {
  // Excel column width unit = max digit width of the default font (7px for 11pt fonts).
  const digit = 7;

  const colX = [0];
  for (const col of model.columns) colX.push(colX[colX.length - 1] + (col.w > 0 ? Math.round(col.w * digit + 5) : 0));
  const contentW = colX[colX.length - 1] || 1;

  const heights = new Map(model.rows.map((r) => [r.r, r.h]));
  const rowY = [0, 0];
  for (let r = 1; r <= model.lastRow; r += 1) rowY.push(rowY[r] + (heights.get(r) || model.defaultRowHeight || 15) * PT);

  const page = A4[model.page?.orientation === 'landscape' ? 'landscape' : 'portrait'];
  const m = model.page?.margins || { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 };
  const margin = { l: m.left * 96, r: m.right * 96, t: m.top * 96, b: m.bottom * 96 };
  const printableW = page.w - margin.l - margin.r;
  const printableH = page.h - margin.t - margin.b;
  const scale = model.page?.fitToWidth ? Math.min(1, printableW / contentW) : 1;
  const pageContentH = printableH / scale;
  const offsetX = model.page?.horizontalCentered ? Math.max(0, (printableW - contentW * scale) / 2) : 0;

  const pages = [];
  let start = 1;
  for (let r = 1; r <= model.lastRow; r += 1) {
    if (rowY[r + 1] - rowY[start] > pageContentH && r > start) {
      pages.push({ from: start, to: r - 1 });
      start = r;
    }
  }
  pages.push({ from: start, to: Math.max(start, model.lastRow) });

  return { colX, contentW, rowY, page, margin, scale, offsetX, pages, pageContentH };
}

function SheetPage({ model, layout, range, showGrid }) {
  const { colX, rowY, contentW, page, margin, scale, offsetX, pageContentH } = layout;
  const top = rowY[range.from];
  const height = rowY[range.to + 1] - top;

  const mergeAt = useMemo(() => {
    const map = new Map();
    for (const mg of model.merges || []) map.set(`${mg.top}:${mg.left}`, mg);
    return map;
  }, [model.merges]);

  const cells = [];
  for (const row of model.rows) {
    if (row.r < range.from || row.r > range.to) continue;
    const filled = row.cells.filter((c) => c.t !== '').map((c) => c.c);
    for (const cell of row.cells) {
      const s = model.styles[cell.s] || {};
      const mg = mergeAt.get(`${row.r}:${cell.c}`);
      const right = mg ? mg.right : cell.c;
      const bottom = mg ? Math.min(mg.bottom, range.to) : row.r;
      const x = colX[cell.c - 1];
      const w = colX[Math.min(right, colX.length - 1)] - x;
      const y = rowY[row.r] - top;
      const h = rowY[bottom + 1] - rowY[row.r];
      const justify = s.h === 'center' || s.h === 'centerContinuous' ? 'center' : s.h === 'right' ? 'flex-end' : 'flex-start';
      const align = s.v === 'top' ? 'flex-start' : s.v === 'middle' || s.v === 'center' ? 'center' : 'flex-end';
      // Like Excel, left-aligned text may spill right over empty cells but stops at the next filled one.
      const spill = !s.w && !mg && justify === 'flex-start';
      const nextFilled = spill ? filled.find((c) => c > right) : undefined;
      const spillWidth = spill ? (nextFilled ? colX[nextFilled - 1] : contentW) - x : w;
      cells.push(
        <div
          key={`${row.r}:${cell.c}`}
          className="xl-cell"
          style={{
            left: x,
            top: y,
            width: w,
            height: h,
            justifyContent: justify,
            alignItems: align,
            overflow: s.w ? 'hidden' : 'visible',
            fontFamily: fontStack(s.n),
            fontSize: (s.sz || 11) * PT,
            fontWeight: s.b ? 700 : 400,
            fontStyle: s.i ? 'italic' : 'normal',
            textDecoration: [s.u && 'underline', s.st && 'line-through'].filter(Boolean).join(' ') || 'none',
            color: s.c || '#000',
            background: s.bg || undefined,
            borderTop: border(s.bt),
            borderLeft: border(s.bl),
            borderBottom: border(s.bb),
            borderRight: border(s.br),
            paddingLeft: 2 + (s.in || 0) * 9,
          }}
        >
          <span
            style={{
              whiteSpace: s.w ? 'pre-wrap' : 'pre',
              ...(spill ? { maxWidth: Math.max(w, spillWidth) - 4, overflow: 'hidden', flexShrink: 0 } : null),
            }}
          >
            {cell.t}
          </span>
        </div>,
      );
    }
  }

  return (
    <div className="sheet-page" style={{ width: page.w, height: page.h }}>
      <div
        className="sheet-content"
        style={{
          left: margin.l + offsetX,
          top: margin.t,
          width: contentW,
          height: Math.min(height, pageContentH),
          transform: `scale(${scale})`,
        }}
      >
        {showGrid && (
          <svg className="sheet-grid" width={contentW} height={height} aria-hidden="true">
            {colX.map((x) => (
              <line key={`c${x}`} x1={x + 0.5} x2={x + 0.5} y1={0} y2={height} />
            ))}
            {rowY.slice(range.from, range.to + 2).map((y) => (
              <line key={`r${y}`} x1={0} x2={contentW} y1={y - top + 0.5} y2={y - top + 0.5} />
            ))}
          </svg>
        )}
        {cells}
      </div>
    </div>
  );
}

export default function SheetPreview({ model, zoom = 1, showGrid = false, maxPages, className = '' }) {
  const layout = useMemo(() => (model ? layoutSheet(model) : null), [model]);
  if (!model || !layout) return null;
  const pages = maxPages ? layout.pages.slice(0, maxPages) : layout.pages;
  return (
    <div className={`sheet-pages ${className}`} style={{ zoom }}>
      {pages.map((range, i) => (
        <SheetPage key={i} model={model} layout={layout} range={range} showGrid={showGrid} />
      ))}
    </div>
  );
}

// Small first-page preview for cards.
export function SheetThumbnail({ model, width = 260 }) {
  const layout = useMemo(() => (model ? layoutSheet(model) : null), [model]);
  if (!model || !layout) return <div className="thumb-skeleton" style={{ width, height: width * 1.414 }} />;
  const ratio = width / layout.page.w;
  return (
    <div className="sheet-thumb" style={{ width, height: layout.page.h * ratio }}>
      <div style={{ transform: `scale(${ratio})`, transformOrigin: 'top left', width: layout.page.w }}>
        <SheetPage model={model} layout={layout} range={layout.pages[0]} showGrid={false} />
      </div>
    </div>
  );
}

export function pageCount(model) {
  return model ? layoutSheet(model).pages.length : 0;
}
