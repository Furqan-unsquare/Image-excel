import { useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

export default function UploadTemplateDialog({ onClose, onCreated, aiAvailable }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setError('');
    if (!name) setName(f.name.replace(/\.xlsx$/i, ''));
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!file) return setError('Choose an Excel file first.');
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim());
      form.append('useAi', String(useAi));
      const template = await api.templates.create(form);
      onCreated(template);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload a new format"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !file}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
            {busy ? 'Reading format…' : 'Save format'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <p className="muted">
          Upload a sample question paper made in Excel. The app learns its header, fonts, columns, question and
          marks style, and uses them for every paper you make with it.
        </p>
        <label
          className={`file-drop ${file ? 'has-file' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files?.[0])} hidden />
          <FileSpreadsheet size={28} />
          <span>{file ? file.name : 'Click or drop an .xlsx file here'}</span>
        </label>
        <label className="field">
          <span>Format name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unit test – Std 5" maxLength={120} />
        </label>
        {aiAvailable && (
          <label className="check">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            <span>Use AI to detect the layout (for unusual formats)</span>
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </form>
    </Modal>
  );
}
