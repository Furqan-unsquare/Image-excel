import { useEffect, useRef, useState } from 'react';
import { Grid3x3, LoaderCircle, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import SheetPreview, { pageCount } from './SheetPreview.jsx';

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const PAGE_WIDTH = 794;

export default function PreviewPanel({ model, loading, error, actions, printable = false }) {
  const [zoom, setZoom] = useState(null);
  const [grid, setGrid] = useState(false);
  const scrollRef = useRef(null);

  const fitZoom = () => {
    const el = scrollRef.current;
    if (!el) return 1;
    const css = getComputedStyle(el);
    const inner = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    return Math.max(0.25, Math.min(1.5, (inner - 2) / PAGE_WIDTH));
  };

  useEffect(() => {
    if (zoom === null && scrollRef.current) setZoom(Math.min(1, fitZoom()));
  }, [zoom]);

  const current = zoom ?? 1;
  const stepIn = () => setZoom(STEPS.find((s) => s > current + 0.001) ?? current);
  const stepOut = () => setZoom([...STEPS].reverse().find((s) => s < current - 0.001) ?? current);
  const pages = pageCount(model);

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="toolbar-group">
          <button className="icon-btn" onClick={stepOut} aria-label="Zoom out" title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <button className="zoom-value" onClick={() => setZoom(1)} title="Reset to 100%">
            {Math.round(current * 100)}%
          </button>
          <button className="icon-btn" onClick={stepIn} aria-label="Zoom in" title="Zoom in">
            <ZoomIn size={18} />
          </button>
          <button className="icon-btn" onClick={() => setZoom(fitZoom())} aria-label="Fit to width" title="Fit to width">
            <Maximize2 size={17} />
          </button>
          <span className="toolbar-sep" />
          <button
            className={`icon-btn ${grid ? 'is-on' : ''}`}
            onClick={() => setGrid((g) => !g)}
            aria-pressed={grid}
            title="Show cell gridlines"
          >
            <Grid3x3 size={17} />
          </button>
          {model && (
            <span className="muted small">
              {pages} page{pages === 1 ? '' : 's'} · A4
            </span>
          )}
        </div>
        <div className="toolbar-group">{actions}</div>
      </div>
      <div className="preview-scroll" ref={scrollRef}>
        {loading && (
          <div className="center-msg">
            <LoaderCircle className="spin" size={22} /> Loading preview…
          </div>
        )}
        {error && !loading && <div className="alert alert-error">{error}</div>}
        {model && !loading && (
          <div className={printable ? 'print-root' : ''}>
            <SheetPreview model={model} zoom={current} showGrid={grid} />
          </div>
        )}
      </div>
    </div>
  );
}
