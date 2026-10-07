import { useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, LoaderCircle, Plus, Save, Table2, Trash2, Undo2 } from 'lucide-react';

// Client-only keys keep React rows stable while items are added, moved or removed.
// The server ignores unknown fields, so they never reach the database.
let keySeed = 0;
const newKey = () => `k${++keySeed}`;
const emptyItem = () => ({ _key: newKey(), label: '', text: '', options: [], answer: '' });
const emptyQuestion = () => ({ _key: newKey(), number: '', text: '', marks: '', note: '', items: [emptyItem()], table: { headers: [], rows: [] } });

function withKeys(content) {
  const c = structuredClone(content || { meta: {}, sections: [] });
  if (!c.sections?.length) c.sections = [{ title: '', questions: [] }];
  for (const s of c.sections) {
    s._key = newKey();
    for (const q of s.questions || []) {
      q._key = newKey();
      q.items = q.items || [];
      q.table = q.table || { headers: [], rows: [] };
      for (const it of q.items) it._key = newKey();
    }
  }
  return c;
}

function moveInArray(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

function ItemRow({ item, index, onChange, onRemove }) {
  const [showExtra, setShowExtra] = useState(Boolean(item.options?.length || item.answer));
  const [optionsText, setOptionsText] = useState((item.options || []).join(' / '));
  return (
    <div className="item-row">
      <input
        className="input-label"
        value={item.label}
        onChange={(e) => onChange({ ...item, label: e.target.value })}
        placeholder={String(index + 1)}
        aria-label="Sub-question number"
      />
      <div className="item-main">
        <input
          value={item.text}
          onChange={(e) => onChange({ ...item, text: e.target.value })}
          placeholder="Sub-question text (use ______ for blanks)"
          aria-label="Sub-question text"
        />
        {showExtra ? (
          <div className="item-extra">
            <input
              value={optionsText}
              onChange={(e) => {
                setOptionsText(e.target.value);
                onChange({ ...item, options: e.target.value.split('/').map((o) => o.trim()).filter(Boolean) });
              }}
              placeholder="Options, separated by /  (e.g. Zoom in / Redo / Undo)"
              aria-label="Options"
            />
            <input
              value={item.answer}
              onChange={(e) => onChange({ ...item, answer: e.target.value })}
              placeholder="Answer (printed only when answers are included)"
              aria-label="Answer"
            />
          </div>
        ) : (
          <button type="button" className="link-btn small" onClick={() => setShowExtra(true)}>
            + options / answer
          </button>
        )}
      </div>
      <button type="button" className="icon-btn danger" onClick={onRemove} aria-label="Remove sub-question">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function TableEditor({ table, onChange }) {
  const [headersText, setHeadersText] = useState((table.headers || []).join(', '));
  const [rowsText, setRowsText] = useState((table.rows || []).map((r) => r.join(' | ')).join('\n'));
  const parseHeaders = (text) => text.split(',').map((h) => h.trim()).filter(Boolean);
  const parseRows = (text) => (text.trim() ? text.split('\n').map((line) => line.split('|').map((c) => c.trim())) : []);
  return (
    <div className="table-editor">
      <label className="field">
        <span>Table columns (comma separated)</span>
        <input
          value={headersText}
          onChange={(e) => {
            setHeadersText(e.target.value);
            onChange({ headers: parseHeaders(e.target.value), rows: parseRows(rowsText) });
          }}
          placeholder="Material, Written, Oral"
        />
      </label>
      <label className="field">
        <span>Rows – one per line, cells separated by | (leave empty for blank rows)</span>
        <textarea
          rows={Math.min(6, Math.max(2, rowsText.split('\n').length))}
          value={rowsText}
          onChange={(e) => {
            setRowsText(e.target.value);
            onChange({ headers: parseHeaders(headersText), rows: parseRows(e.target.value) });
          }}
          placeholder="Empty = blank rows for students to fill"
        />
      </label>
      <button type="button" className="link-btn small danger" onClick={() => onChange({ headers: [], rows: [] })}>
        Remove table
      </button>
    </div>
  );
}

export default function PaperEditor({ paper, onSave, saving }) {
  const initial = () => structuredClone({
    title: paper.title || '',
    includeAnswers: Boolean(paper.options?.includeAnswers),
    content: withKeys(paper.content),
  });
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);

  const mutate = (fn) => {
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const { content } = draft;
  const header = content.header || [];
  const hasAnswers = content.sections.some((s) => s.questions.some((q) => q.items?.some((i) => i.answer)));
  const questionCount = content.sections.reduce((n, s) => n + s.questions.length, 0);

  const renumber = () =>
    mutate((d) => {
      for (const s of d.content.sections) {
        let n = 0;
        for (const q of s.questions) {
          if (q.text || q.number) q.number = String(++n);
          q.items?.forEach((it, i) => (it.label = String(i + 1)));
        }
      }
    });

  const save = () => onSave({ title: draft.title, includeAnswers: draft.includeAnswers, content: draft.content }).then((ok) => ok && setDirty(false));

  return (
    <div className="editor">
      <div className="card">
        <div className="card-head">
          <h3>Paper details</h3>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Paper name (used for the file name)</span>
            <input value={draft.title} onChange={(e) => mutate((d) => (d.title = e.target.value))} maxLength={120} />
          </label>
          <div className="field">
            <span>Answers</span>
            <label className="check">
              <input type="checkbox" checked={draft.includeAnswers} onChange={(e) => mutate((d) => (d.includeAnswers = e.target.checked))} />
              <span>Print answers below questions (answer key){!hasAnswers && ' – no answers found yet'}</span>
            </label>
          </div>
        </div>
        {header.length > 0 && (
          <>
            <div className="subhead">Header lines from the format</div>
            <div className="grid-2">
              {header.map((line, i) => (
                <label className="field" key={line.address}>
                  <span>Cell {line.address}</span>
                  <input value={line.text} onChange={(e) => mutate((d) => (d.content.header[i].text = e.target.value))} />
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {content.sections.map((section, si) => (
        <div className="card" key={section._key}>
          <div className="card-head">
            <input
              className="section-title-input"
              value={section.title}
              onChange={(e) => mutate((d) => (d.content.sections[si].title = e.target.value))}
              placeholder={content.sections.length > 1 ? 'Section title (e.g. HISTORY)' : 'Section title (optional, e.g. HISTORY)'}
              aria-label="Section title"
            />
            <div className="row-actions">
              <button type="button" className="icon-btn" disabled={si === 0} onClick={() => mutate((d) => moveInArray(d.content.sections, si, -1))} aria-label="Move section up">
                <ArrowUp size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={si === content.sections.length - 1} onClick={() => mutate((d) => moveInArray(d.content.sections, si, 1))} aria-label="Move section down">
                <ArrowDown size={16} />
              </button>
              {content.sections.length > 1 && (
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => window.confirm('Remove this section and its questions?') && mutate((d) => d.content.sections.splice(si, 1))}
                  aria-label="Remove section"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>

          {section.questions.map((q, qi) => (
            <div className="question-block" key={q._key}>
              <div className="question-row">
                <input
                  className="input-label"
                  value={q.number}
                  onChange={(e) => mutate((d) => (d.content.sections[si].questions[qi].number = e.target.value))}
                  placeholder="No."
                  aria-label="Question number"
                />
                <input
                  className="input-strong"
                  value={q.text}
                  onChange={(e) => mutate((d) => (d.content.sections[si].questions[qi].text = e.target.value))}
                  placeholder="Question / instruction (e.g. Fill in the blanks)"
                  aria-label="Question text"
                />
                <input
                  className="input-marks"
                  value={q.marks}
                  onChange={(e) => mutate((d) => (d.content.sections[si].questions[qi].marks = e.target.value))}
                  placeholder="Marks"
                  aria-label="Marks"
                />
                <div className="row-actions">
                  <button type="button" className="icon-btn" disabled={qi === 0} onClick={() => mutate((d) => moveInArray(d.content.sections[si].questions, qi, -1))} aria-label="Move question up">
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={qi === section.questions.length - 1}
                    onClick={() => mutate((d) => moveInArray(d.content.sections[si].questions, qi, 1))}
                    aria-label="Move question down"
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => mutate((d) => d.content.sections[si].questions.splice(qi, 1))}
                    aria-label="Remove question"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="question-body">
                <input
                  className="input-note"
                  value={q.note}
                  onChange={(e) => mutate((d) => (d.content.sections[si].questions[qi].note = e.target.value))}
                  placeholder="Note / word bank under the question (optional)"
                  aria-label="Note"
                />

                {q.table?.headers?.length || q.table?.rows?.length ? (
                  <TableEditor key={`${q._key}-table`} table={q.table} onChange={(table) => mutate((d) => (d.content.sections[si].questions[qi].table = table))} />
                ) : null}

                {q.items.map((item, ii) => (
                  <ItemRow
                    key={item._key}
                    item={item}
                    index={ii}
                    onChange={(next) => mutate((d) => (d.content.sections[si].questions[qi].items[ii] = next))}
                    onRemove={() => mutate((d) => d.content.sections[si].questions[qi].items.splice(ii, 1))}
                  />
                ))}

                <div className="inline-actions">
                  <button type="button" className="link-btn small" onClick={() => mutate((d) => d.content.sections[si].questions[qi].items.push(emptyItem()))}>
                    <Plus size={14} /> Sub-question
                  </button>
                  {!(q.table?.headers?.length || q.table?.rows?.length) && (
                    <button
                      type="button"
                      className="link-btn small"
                      onClick={() => mutate((d) => (d.content.sections[si].questions[qi].table = { headers: ['Column 1', 'Column 2', 'Column 3'], rows: [] }))}
                    >
                      <Table2 size={14} /> Table
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-ghost" onClick={() => mutate((d) => d.content.sections[si].questions.push(emptyQuestion()))}>
            <Plus size={16} /> Add question
          </button>
        </div>
      ))}

      <button type="button" className="btn btn-ghost" onClick={() => mutate((d) => d.content.sections.push({ _key: newKey(), title: '', questions: [emptyQuestion()] }))}>
        <Plus size={16} /> Add section
      </button>

      <div className="editor-footer">
        <span className="muted small">
          {questionCount} question{questionCount === 1 ? '' : 's'}
          {dirty ? ' · unsaved changes' : ''}
        </span>
        <div className="row-actions">
          <button type="button" className="btn" onClick={renumber} title="Number questions 1, 2, 3… in each section" aria-label="Renumber questions">
            <ListOrdered size={16} /> <span className="btn-label">Renumber</span>
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Discard changes"
            title="Discard changes"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(initial());
              setDirty(false);
            }}
          >
            <Undo2 size={16} /> <span className="btn-label">Discard</span>
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
            Save & update Excel
          </button>
        </div>
      </div>
    </div>
  );
}
