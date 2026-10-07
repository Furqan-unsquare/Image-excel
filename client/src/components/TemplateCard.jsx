import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, colLetter } from '../api.js';
import { SheetThumbnail } from './SheetPreview.jsx';

const previewCache = new Map();

export function useTemplatePreview(id, kind = 'preview', version = '') {
  const key = `${id}:${kind}:${version}`;
  const [model, setModel] = useState(() => previewCache.get(key) || null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    if (previewCache.has(key)) {
      setModel(previewCache.get(key));
      return undefined;
    }
    setModel(null);
    const load = kind === 'sample' ? api.templates.samplePreview(id) : api.templates.preview(id);
    load
      .then((m) => {
        previewCache.set(key, m);
        if (alive) setModel(m);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, kind, key]);
  return { model, error };
}

export function templateSummary(profile) {
  if (!profile) return [];
  const parts = [];
  if (profile.header?.cells?.length) parts.push(`Header ${profile.header.cells.length} line${profile.header.cells.length > 1 ? 's' : ''}`);
  parts.push(`Questions in ${colLetter(profile.question?.col)}`);
  if (profile.marks?.col) parts.push(`Marks in ${colLetter(profile.marks.col)}`);
  parts.push(`Items "${(profile.item?.numberFormat || '{n}.').replace('{n}', '1')}"`);
  return parts;
}

export default function TemplateCard({ template, selected, onSelect, footer }) {
  const { model, error } = useTemplatePreview(template.id, 'preview', template.updatedAt);
  return (
    <button
      type="button"
      className={`template-card ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect?.(template)}
      aria-pressed={selected}
    >
      <div className="template-thumb-wrap">
        {error ? <div className="thumb-error">Preview unavailable</div> : <SheetThumbnail model={model} width={220} />}
        {selected && (
          <span className="selected-badge">
            <Check size={14} /> Selected
          </span>
        )}
      </div>
      <div className="template-meta">
        <div className="template-name" title={template.name}>
          {template.name}
        </div>
        <div className="chips">
          {templateSummary(template.profile).slice(0, 3).map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
        {footer}
      </div>
    </button>
  );
}
