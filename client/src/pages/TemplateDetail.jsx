import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, LoaderCircle, RefreshCw, Save, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { api, colLetter } from '../api.js';
import PreviewPanel from '../components/PreviewPanel.jsx';
import { useTemplatePreview } from '../components/TemplateCard.jsx';
import { useToast } from '../components/Toast.jsx';

const NUMBER_STYLES = [
  ['arabic', '1, 2, 3'],
  ['alpha-lower', 'a, b, c'],
  ['alpha-upper', 'A, B, C'],
  ['roman-lower', 'i, ii, iii'],
  ['roman-upper', 'I, II, III'],
];

const SPACING = [
  ['afterHeader', 'After the header'],
  ['beforeSection', 'Before a section title'],
  ['afterSection', 'After a section title'],
  ['afterQuestion', 'After a question heading'],
  ['betweenItems', 'Between sub-questions'],
  ['betweenQuestions', 'Between questions'],
  ['beforeTable', 'Around a table'],
];

function settingsFromProfile(p) {
  return {
    question: {
      col: p.question.col,
      numberFormat: p.question.numberFormat,
      numberStyle: p.question.numberStyle,
      suffix: p.question.suffix,
      indent: p.question.indent,
      gap: p.question.gap,
      bold: Boolean(p.question.style?.font?.bold),
      italic: Boolean(p.question.style?.font?.italic),
    },
    marks: {
      col: p.marks.col,
      format: p.marks.format,
      whenMissing: p.marks.whenMissing || (p.marks.col ? 'fixed' : 'none'),
      defaultValue: p.marks.defaultValue ?? 2,
    },
    answerLines: p.answerLines !== false,
    item: { col: p.item.col, numberFormat: p.item.numberFormat, numberStyle: p.item.numberStyle, indent: p.item.indent, gap: p.item.gap },
    continuation: { col: p.continuation.col, indent: p.continuation.indent },
    section: { col: p.section.col, uppercase: Boolean(p.section.uppercase) },
    spacing: { ...p.spacing },
    wrap: { maxChars: p.wrap?.maxChars ?? '' },
    print: { orientation: p.print?.orientation || 'portrait' },
  };
}

function ColumnSelect({ value, onChange, allowNone, max = 16 }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">{allowNone}</option>}
      {Array.from({ length: Math.max(max, value || 0) }, (_, i) => i + 1).map((c) => (
        <option key={c} value={c}>
          Column {colLetter(c)}
        </option>
      ))}
    </select>
  );
}

const NumberInput = ({ value, onChange, min = 0, max = 30 }) => (
  <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
);

export default function TemplateDetail({ health }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('sample');
  const [name, setName] = useState('');
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState('');

  const load = (t) => {
    setTemplate(t);
    setName(t.name);
    setSettings(settingsFromProfile(t.profile));
  };

  useEffect(() => {
    api.templates.get(id).then(load).catch((e) => setError(e.message));
  }, [id]);

  const { model, error: previewError } = useTemplatePreview(id, view, template?.updatedAt || '');

  const set = (group, key, value) => setSettings((s) => ({ ...s, [group]: { ...s[group], [key]: value } }));

  const save = async () => {
    setBusy('save');
    try {
      load(await api.templates.update(id, { name, settings }));
      setView('sample');
      toast('Format saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const reanalyze = async (useAi) => {
    if (!window.confirm('Detect the layout again? Manual changes to the settings below will be replaced.')) return;
    setBusy(useAi ? 'ai' : 'detect');
    try {
      load(await api.templates.reanalyze(id, useAi));
      toast('Layout detected again');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the format "${template.name}"? Papers already made keep their Excel files.`)) return;
    try {
      await api.templates.remove(id);
      toast('Format deleted');
      navigate('/templates');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!template || !settings) {
    return (
      <div className="page center-msg">
        <LoaderCircle className="spin" size={22} /> Loading…
      </div>
    );
  }

  const s = settings;
  const p = template.profile;

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <Link to="/templates" className="back-link">
            <ArrowLeft size={15} /> Formats
          </Link>
          <h1>{template.name}</h1>
          <p className="muted small">
            {template.originalFileName} · layout detected by {template.analysis?.method === 'llm' ? 'AI' : 'built-in rules'} · used{' '}
            {template.usageCount || 0} time{template.usageCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row-actions wrap">
          <a className="btn" href={api.templates.fileUrl(id)} download>
            <Download size={16} /> Original file
          </a>
          <button className="btn btn-danger-ghost" onClick={remove} aria-label="Delete format">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {template.analysis?.warnings?.length > 0 && (
        <div className="alert alert-warn">
          <TriangleAlert size={18} />
          <ul>
            {template.analysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="split split-settings">
        <PreviewPanel
          model={model}
          loading={!model && !previewError}
          error={previewError}
          actions={
            <div className="segmented">
              <button className={view === 'sample' ? 'active' : ''} onClick={() => setView('sample')}>
                Sample output
              </button>
              <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
                Your file
              </button>
            </div>
          }
        />

        <div className="settings">
          <div className="card">
            <label className="field">
              <span>Format name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
            <p className="muted small">
              Header kept from your file: rows 1–{p.header.endRow || 0}
              {p.header.cells?.length ? ` (${p.header.cells.map((c) => c.address).join(', ')})` : ''}. “Subject”, “Std/Class”,
              “Marks”, “Time” and “Date” values are filled from the photo when found.
            </p>
          </div>

          <div className="card">
            <h3>Question headings</h3>
            <div className="grid-2">
              <label className="field">
                <span>Column</span>
                <ColumnSelect value={s.question.col} onChange={(v) => set('question', 'col', v)} />
              </label>
              <label className="field">
                <span>Number format ({'{n}'} = number)</span>
                <input value={s.question.numberFormat} onChange={(e) => set('question', 'numberFormat', e.target.value)} placeholder="Q{n}." />
              </label>
              <label className="field">
                <span>Numbering</span>
                <select value={s.question.numberStyle} onChange={(e) => set('question', 'numberStyle', e.target.value)}>
                  {NUMBER_STYLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Ending after the text</span>
                <input value={s.question.suffix} onChange={(e) => set('question', 'suffix', e.target.value)} placeholder=" :-" />
              </label>
              <label className="field">
                <span>Spaces before</span>
                <NumberInput value={s.question.indent} onChange={(v) => set('question', 'indent', v)} />
              </label>
              <label className="field">
                <span>Spaces after number</span>
                <NumberInput value={s.question.gap} onChange={(v) => set('question', 'gap', v)} />
              </label>
            </div>
            <div className="row-actions">
              <label className="check">
                <input type="checkbox" checked={s.question.bold} onChange={(e) => set('question', 'bold', e.target.checked)} /> <span>Bold</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.question.italic} onChange={(e) => set('question', 'italic', e.target.checked)} /> <span>Italic</span>
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Marks</h3>
            <div className="grid-2">
              <label className="field">
                <span>Column</span>
                <ColumnSelect value={s.marks.col} allowNone="In the heading text" onChange={(v) => set('marks', 'col', v)} />
              </label>
              <label className="field">
                <span>Format ({'{m}'} = marks)</span>
                <input value={s.marks.format} onChange={(e) => set('marks', 'format', e.target.value)} placeholder="[ {m} M]" />
              </label>
              <label className="field">
                <span>When the photo has no marks</span>
                <select value={s.marks.whenMissing} onChange={(e) => set('marks', 'whenMissing', e.target.value)}>
                  <option value="fixed">Same marks for every question</option>
                  <option value="per-item">1 mark per sub-question</option>
                  <option value="none">Leave empty</option>
                </select>
              </label>
              {s.marks.whenMissing === 'fixed' && (
                <label className="field">
                  <span>Marks per question</span>
                  <NumberInput value={s.marks.defaultValue} min={0} max={100} onChange={(v) => set('marks', 'defaultValue', v)} />
                </label>
              )}
            </div>
            <p className="muted small">
              If some questions on the photo have marks, the most common of those is used for the ones without.
            </p>
          </div>

          <div className="card">
            <h3>Answer space</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={s.answerLines}
                onChange={(e) => setSettings((cur) => ({ ...cur, answerLines: e.target.checked }))}
              />
              <span>
                Add ______ where students write: fill in the blanks, true/false, one word answers, full forms, and short
                answers that were written in the notes (when answers are not printed)
              </span>
            </label>
          </div>

          <div className="card">
            <h3>Sub-questions</h3>
            <div className="grid-2">
              <label className="field">
                <span>Column</span>
                <ColumnSelect value={s.item.col} onChange={(v) => set('item', 'col', v)} />
              </label>
              <label className="field">
                <span>Number format</span>
                <input value={s.item.numberFormat} onChange={(e) => set('item', 'numberFormat', e.target.value)} placeholder="{n}." />
              </label>
              <label className="field">
                <span>Numbering</span>
                <select value={s.item.numberStyle} onChange={(e) => set('item', 'numberStyle', e.target.value)}>
                  {NUMBER_STYLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Spaces before</span>
                <NumberInput value={s.item.indent} onChange={(v) => set('item', 'indent', v)} />
              </label>
              <label className="field">
                <span>Spaces after number</span>
                <NumberInput value={s.item.gap} onChange={(v) => set('item', 'gap', v)} />
              </label>
              <label className="field">
                <span>Long lines continue in</span>
                <ColumnSelect value={s.continuation.col} onChange={(v) => set('continuation', 'col', v)} />
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Sections & page</h3>
            <div className="grid-2">
              <label className="field">
                <span>Section title column</span>
                <ColumnSelect value={s.section.col} onChange={(v) => set('section', 'col', v)} />
              </label>
              <label className="field">
                <span>Max characters per line</span>
                <input
                  type="number"
                  min={30}
                  max={400}
                  value={s.wrap.maxChars}
                  placeholder="Auto"
                  onChange={(e) => set('wrap', 'maxChars', e.target.value === '' ? '' : Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Page</span>
                <select value={s.print.orientation} onChange={(e) => set('print', 'orientation', e.target.value)}>
                  <option value="portrait">A4 portrait</option>
                  <option value="landscape">A4 landscape</option>
                </select>
              </label>
              <label className="check field-check">
                <input type="checkbox" checked={s.section.uppercase} onChange={(e) => set('section', 'uppercase', e.target.checked)} />
                <span>Section titles in CAPITALS</span>
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Blank rows</h3>
            <div className="grid-2">
              {SPACING.map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <NumberInput value={s.spacing[key]} max={5} onChange={(v) => set('spacing', key, v)} />
                </label>
              ))}
            </div>
          </div>

          <div className="settings-footer">
            <button className="btn" onClick={() => reanalyze(false)} disabled={Boolean(busy)}>
              {busy === 'detect' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Detect again
            </button>
            {health?.groq && (
              <button className="btn" onClick={() => reanalyze(true)} disabled={Boolean(busy)}>
                {busy === 'ai' ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} Detect with AI
              </button>
            )}
            <button className="btn btn-primary" onClick={save} disabled={Boolean(busy)}>
              {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
