import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, LoaderCircle, Plus, Wand2 } from 'lucide-react';
import { Loading, LoadError } from '../components/Status.jsx';
import { api } from '../api.js';
import ImageDropzone from '../components/ImageDropzone.jsx';
import TemplateCard from '../components/TemplateCard.jsx';
import UploadTemplateDialog from '../components/UploadTemplateDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const LAST_TEMPLATE_KEY = 'papersheet:lastTemplate';

const readLast = () => {
  try {
    return localStorage.getItem(LAST_TEMPLATE_KEY);
  } catch {
    return null;
  }
};
const saveLast = (id) => {
  try {
    localStorage.setItem(LAST_TEMPLATE_KEY, id);
  } catch {
    /* storage can be blocked; remembering the format is optional */
  }
};

export default function CreatePaper({ health }) {
  const [templates, setTemplates] = useState(null);
  const [selectedId, setSelectedId] = useState(readLast);
  const [images, setImages] = useState([]);
  const [includeAnswers, setIncludeAnswers] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  const loadTemplates = useCallback(async () => {
    setLoadError('');
    try {
      const list = await api.templates.list();
      setTemplates(list);
      setSelectedId((current) => (list.some((t) => t.id === current) ? current : list[0]?.id || null));
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const select = (t) => {
    setSelectedId(t.id);
    saveLast(t.id);
  };

  const selected = templates?.find((t) => t.id === selectedId);
  const canSubmit = Boolean(selected && images.length && !submitting);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('templateId', selected.id);
      form.append('includeAnswers', String(includeAnswers));
      images.forEach((img) => form.append('images', img.file, img.file.name));
      const paper = await api.papers.create(form);
      images.forEach((img) => URL.revokeObjectURL(img.url));
      navigate(`/papers/${paper.id}`);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <section className="hero">
        <h1>Upload photos → print‑ready Excel</h1>
        <p className="muted">
          Pick your file&apos;s format, upload photos of the questions, and download an Excel file.
        </p>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card step">
        <div className="card-head">
          <h2>
            <span className="step-no">1</span> Choose a file
          </h2>
          <button className="btn" onClick={() => setUploadOpen(true)}>
            <Plus size={16} /> Upload new file
          </button>
        </div>
        {templates === null && !loadError && <Loading label="Loading formats…" />}
        {templates === null && loadError && <LoadError message={`Could not load formats. ${loadError}`} onRetry={loadTemplates} />}
        {templates?.length === 0 && (
          <div className="empty">
            <FileSpreadsheet size={32} />
            <p>No formats yet. Upload a sample question paper made in Excel and it will be used as the layout.</p>
            <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              <Plus size={16} /> Upload format
            </button>
          </div>
        )}
        {templates?.length > 0 && (
          <div className="template-grid">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} selected={t.id === selectedId} onSelect={select} />
            ))}
            <button type="button" className="template-card add-card" onClick={() => setUploadOpen(true)}>
              <Plus size={28} />
              <span>New format from Excel</span>
            </button>
          </div>
        )}
      </section>

      <section className="card step">
        <div className="card-head">
          <h2>
            <span className="step-no">2</span> Add question images
          </h2>
        </div>
        <ImageDropzone images={images} onChange={setImages} max={health?.maxImages || 10} />
        <label className="check">
          <input type="checkbox" checked={includeAnswers} onChange={(e) => setIncludeAnswers(e.target.checked)} />
          <span>If the images contain answers, print them under each question.</span>
        </label>
        {health && !health.groq && (
          <div className="alert alert-info">
            AI reading is off (no <code>GROQ_API_KEY</code>), so basic OCR is used. It works for clear printed text
            only; handwriting needs the Groq key.
          </div>
        )}
      </section>

      <div className="action-bar">
        <div className="muted small">
          {selected ? (
            <>
              Format: <strong>{selected.name}</strong>
            </>
          ) : (
            'Choose a format'
          )}
          {' · '}
          {images.length ? `${images.length} image${images.length > 1 ? 's' : ''}` : 'no images yet'}
        </div>
        <button className="btn btn-primary btn-lg" disabled={!canSubmit} onClick={submit}>
          {submitting ? <LoaderCircle size={18} className="spin" /> : <Wand2 size={18} />}
          {submitting ? 'Uploading…' : 'Convert to Excel'}
        </button>
      </div>

      {uploadOpen && (
        <UploadTemplateDialog
          aiAvailable={health?.groq}
          onClose={() => setUploadOpen(false)}
          onCreated={(t) => {
            setTemplates((list) => [t, ...(list || [])]);
            select(t);
            setUploadOpen(false);
            toast(`Format "${t.name}" saved`);
          }}
        />
      )}
    </div>
  );
}
