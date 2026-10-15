import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Languages, LoaderCircle, Plus, Wand2 } from 'lucide-react';
import { Loading, LoadError } from '../components/Status.jsx';
import { api } from '../api.js';
import { FORMAT_EXAMPLES, LANGUAGES, languageOf } from '../lang.js';
import ImageDropzone from '../components/ImageDropzone.jsx';
import TemplateCard from '../components/TemplateCard.jsx';
import UploadTemplateDialog from '../components/UploadTemplateDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const LAST_TEMPLATE_KEY = 'papersheet:lastTemplate';
const LAST_LANGUAGE_KEY = 'papersheet:lastLanguage';

// Remembering the last format and language is optional: storage can be blocked.
const readStored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
};
const readLast = (language) => readStored(`${LAST_TEMPLATE_KEY}:${language}`) || readStored(LAST_TEMPLATE_KEY);
const formatLanguage = (t) => t.language || 'en';

export default function CreatePaper({ health }) {
  const [templates, setTemplates] = useState(null);
  const [language, setLanguage] = useState(() => languageOf(readStored(LAST_LANGUAGE_KEY)).code);
  const [selectedId, setSelectedId] = useState(() => readLast(language));
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
      setTemplates(await api.templates.list());
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Only formats of the chosen language can be used: a Hindi paper needs a Hindi format.
  const visible = templates?.filter((t) => formatLanguage(t) === language) || [];
  useEffect(() => {
    if (!templates) return;
    const list = templates.filter((t) => formatLanguage(t) === language);
    setSelectedId((current) => {
      if (list.some((t) => t.id === current)) return current;
      const last = readLast(language);
      return list.some((t) => t.id === last) ? last : list[0]?.id || null;
    });
  }, [templates, language]);

  const select = (t) => {
    setSelectedId(t.id);
    store(LAST_TEMPLATE_KEY, t.id);
    store(`${LAST_TEMPLATE_KEY}:${formatLanguage(t)}`, t.id);
  };

  const chooseLanguage = (code) => {
    setLanguage(code);
    store(LAST_LANGUAGE_KEY, code);
  };

  const lang = languageOf(language);
  const selected = visible.find((t) => t.id === selectedId);
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
          Pick the paper&apos;s language and format, upload photos of the questions, and download an Excel file.
        </p>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card step">
        <div className="card-head">
          <h2>
            <span className="step-no">1</span> Choose language &amp; format
          </h2>
          <button className="btn" onClick={() => setUploadOpen(true)}>
            <Plus size={16} /> Upload file
          </button>
        </div>
        <div className="language-picker" role="radiogroup" aria-label="Paper language">
          <Languages size={17} className="muted" aria-hidden="true" />
          <div className="segmented">
            {LANGUAGES.map((l) => {
              const count = templates?.filter((t) => formatLanguage(t) === l.code).length;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={language === l.code}
                  className={language === l.code ? 'active' : ''}
                  onClick={() => chooseLanguage(l.code)}
                  title={`${l.name} papers`}
                >
                  {l.native}
                  {templates && <span className="count">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
        {templates === null && !loadError && <Loading label="Loading formats…" />}
        {templates === null && loadError && <LoadError message={`Could not load formats. ${loadError}`} onRetry={loadTemplates} />}
        {templates && visible.length === 0 && (
          <div className="empty">
            <FileSpreadsheet size={32} />
            {language === 'en' ? (
              <p>No formats yet. Upload a sample question paper made in Excel and it will be used as the layout.</p>
            ) : (
              <p className="text-center">
                <strong>
                  {lang.name} papers need a {lang.name} format first.
                </strong>{' '}
                Upload your school&apos;s {lang.name} question paper made in Excel (headings like {FORMAT_EXAMPLES[language]}). It
                is used as the layout for every {lang.name} paper.
              </p>
            )}
            <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              <Plus size={16} /> Upload {language === 'en' ? '' : `${lang.name} `}format
            </button>
          </div>
        )}
        {visible.length > 0 && (
          <div className="template-grid">
            {visible.map((t) => (
              <TemplateCard key={t.id} template={t} selected={t.id === selectedId} onSelect={select} />
            ))}
            <button type="button" className="template-card add-card" onClick={() => setUploadOpen(true)}>
              <Plus size={28} />
              <span>New {language === 'en' ? '' : `${lang.name} `}format from Excel</span>
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
        <ul className="tips muted small">
          {language !== 'en' && (
            <li>
              {lang.name}: clear photos of printed papers are read best. Handwriting is read less accurately, and words
              that need a check are highlighted after converting.
            </li>
          )}
          <li>Maths papers work too (fractions, powers, √, ×, ÷). Diagrams and figures are left out for now.</li>
        </ul>
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
              {language !== 'en' && ` · ${lang.native}`}
            </>
          ) : language === 'en' ? (
            'Choose a format'
          ) : (
            `Upload a ${lang.name} format first`
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
          defaultLanguage={language}
          onClose={() => setUploadOpen(false)}
          onCreated={(t) => {
            setTemplates((list) => [t, ...(list || [])]);
            select(t);
            if (formatLanguage(t) !== language) chooseLanguage(formatLanguage(t));
            setUploadOpen(false);
            toast(`${languageOf(formatLanguage(t)).name} format "${t.name}" saved`);
          }}
        />
      )}
    </div>
  );
}
