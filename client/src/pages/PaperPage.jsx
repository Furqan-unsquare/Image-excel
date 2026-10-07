import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CircleX,
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Printer,
  RefreshCw,
  ScanText,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { api, formatDate } from '../api.js';
import PaperEditor from '../components/PaperEditor.jsx';
import { Loading, LoadError } from '../components/Status.jsx';
import PreviewPanel from '../components/PreviewPanel.jsx';
import SheetPreview from '../components/SheetPreview.jsx';
import { useToast } from '../components/Toast.jsx';

const STAGES = [
  { key: 'prepare', label: 'Preparing images' },
  { key: 'ocr', label: 'Reading the text' },
  { key: 'structure', label: 'Finding questions, sub-questions and marks' },
  { key: 'excel', label: 'Building the Excel file' },
];

function Processing({ paper, connectionIssue }) {
  const current = STAGES.findIndex((s) => s.key === paper.progress?.stage);
  return (
    <div className="card processing">
      <div className="processing-head">
        <LoaderCircle className="spin" size={22} />
        <div>
          <h2>Converting your images…</h2>
          <p className="muted small">{paper.progress?.message || 'Starting'} · this usually takes 10–60 seconds</p>
        </div>
      </div>
      {connectionIssue && (
        <div className="alert alert-warn small">Connection problem ({connectionIssue}). Still trying…</div>
      )}
      <div className="progress">
        <div className="progress-bar" style={{ width: `${Math.max(4, paper.progress?.percent || 0)}%` }} />
      </div>
      <ol className="stages">
        {STAGES.map((s, i) => (
          <li key={s.key} className={i < current ? 'done' : i === current ? 'active' : ''}>
            <span className="stage-dot">{i < current ? <Check size={13} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Prints the A4 pages of the preview (rendered into <body> only while printing).
function usePrint(model) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const timer = setTimeout(() => {
      window.print();
      setTimeout(done, 500);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  const portal =
    printing && model
      ? createPortal(
          <div className="print-only">
            <style>{`@page { size: A4 ${model.page?.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }`}</style>
            <SheetPreview model={model} zoom={1} />
          </div>,
          document.body,
        )
      : null;
  return { print: () => setPrinting(true), portal };
}

export default function PaperPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ['preview', 'edit', 'source'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'preview';
  const setTab = (next) => setSearchParams(next === 'preview' ? {} : { tab: next }, { replace: true });
  const [saving, setSaving] = useState(false);
  const { print, portal } = usePrint(preview);

  const loadPaper = useCallback(() => api.papers.get(id).then(setPaper), [id]);

  useEffect(() => {
    setPaper(null);
    setPreview(null);
    setError('');
    loadPaper().catch((e) => setError(e.message));
  }, [loadPaper]);

  // Poll while processing. A failed poll (network blip, server waking up) keeps
  // the page and tries again a little later instead of showing an error page.
  const [pollIssue, setPollIssue] = useState('');
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    if (paper?.status !== 'processing') return undefined;
    const timer = setTimeout(
      () =>
        loadPaper()
          .then(() => setPollIssue(''))
          .catch((e) => {
            setPollIssue(e.message);
            setPollTick((t) => t + 1);
          }),
      pollIssue ? 5000 : 1500,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, loadPaper, pollTick]);

  // Load the preview whenever a new Excel file was generated.
  useEffect(() => {
    if (paper?.status !== 'done' || !paper.generatedAt) return;
    let alive = true;
    setPreviewLoading(true);
    setPreviewError('');
    api.papers
      .preview(id)
      .then((m) => alive && setPreview(m))
      .catch((e) => alive && setPreviewError(e.message))
      .finally(() => alive && setPreviewLoading(false));
    return () => {
      alive = false;
    };
  }, [id, paper?.status, paper?.generatedAt]);

  const retry = async () => {
    try {
      setPaper(await api.papers.retry(id));
      setPreview(null);
      setTab('preview');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this paper and its images?')) return;
    try {
      await api.papers.remove(id);
      toast('Paper deleted');
      navigate('/history');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const save = async (body) => {
    setSaving(true);
    try {
      const updated = await api.papers.saveContent(id, body);
      setPaper(updated);
      setTab('preview');
      toast('Saved – Excel file updated');
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <LoadError
          message={`Could not load this paper. ${error}`}
          onRetry={() => {
            setError('');
            return loadPaper().catch((e) => setError(e.message));
          }}
        >
          <Link className="btn btn-sm" to="/">
            <ArrowLeft size={15} /> New paper
          </Link>
        </LoadError>
      </div>
    );
  }
  if (!paper) {
    return (
      <div className="page">
        <Loading label="Loading paper…" />
      </div>
    );
  }

  const questionCount = (paper.content?.sections || []).reduce((n, s) => n + (s.questions?.length || 0), 0);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <Link to="/" className="back-link">
            <ArrowLeft size={15} /> New paper
          </Link>
          <h1>{paper.title}</h1>
          <p className="muted small">
            Format: {paper.templateName || '—'} · {paper.images.length} image{paper.images.length === 1 ? '' : 's'}
            {paper.status === 'done' && ` · ${questionCount} question${questionCount === 1 ? '' : 's'}`} ·{' '}
            {formatDate(paper.createdAt)}
          </p>
        </div>
        <div className="row-actions wrap page-actions">
          {paper.status === 'done' && (
            <>
              <a className="btn btn-primary" href={api.papers.downloadUrl(id)} download={paper.fileName}>
                <Download size={16} /> Download Excel
              </a>
              <button className="btn" onClick={print} disabled={!preview}>
                <Printer size={16} /> Print
              </button>
            </>
          )}
          {paper.status !== 'processing' && (
            <button className="btn" onClick={retry} title="Read the images again (e.g. after adding a Groq key)">
              <RefreshCw size={16} /> Run again
            </button>
          )}
          <button className="btn btn-danger-ghost" onClick={remove} aria-label="Delete paper">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {paper.status === 'processing' && <Processing paper={paper} connectionIssue={pollIssue} />}

      {paper.status === 'failed' && (
        <div className="card failed">
          <CircleX size={28} />
          <div>
            <h2>Could not convert these images</h2>
            <p>{paper.error}</p>
            <button className="btn btn-primary" onClick={retry}>
              <RefreshCw size={16} /> Run again
            </button>
          </div>
        </div>
      )}

      {paper.status === 'done' && (
        <>
          {paper.warnings?.length > 0 && (
            <div className="alert alert-warn">
              <TriangleAlert size={18} />
              <ul>
                {paper.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
              <Eye size={16} /> Preview
            </button>
            <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
              <Pencil size={16} />
              <span>
                Edit<span className="hide-sm"> questions</span>
              </span>
            </button>
            <button role="tab" aria-selected={tab === 'source'} className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
              <ScanText size={16} />
              <span>
                Source<span className="hide-sm"> &amp; text</span>
              </span>
            </button>
          </div>

          {tab === 'preview' && <PreviewPanel model={preview} loading={previewLoading && !preview} error={previewError} />}

          {tab === 'edit' && (
            <div className="split">
              <PaperEditor key={paper.generatedAt} paper={paper} onSave={save} saving={saving} />
              <aside className="source-aside">
                <div className="muted small">Original images</div>
                {paper.images.map((img) => (
                  <a key={img.index} href={api.papers.imageUrl(id, img.index)} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={api.papers.imageUrl(id, img.index)} alt={`Page ${img.index + 1}`} loading="lazy" />
                  </a>
                ))}
              </aside>
            </div>
          )}

          {tab === 'source' && (
            <div className="split">
              <div className="card">
                <div className="card-head">
                  <h3>Text read from the images</h3>
                  <span className="chips">
                    <span className="chip">OCR: {paper.ocr?.method === 'groq-vision' ? 'Groq vision' : paper.ocr?.method || '—'}</span>
                    <span className="chip">Structure: {paper.structureMethod === 'groq' ? 'Groq AI' : 'built-in rules'}</span>
                  </span>
                </div>
                <pre className="ocr-text">{paper.ocr?.text || '(no text)'}</pre>
              </div>
              <aside className="source-aside">
                {paper.images.map((img) => (
                  <a key={img.index} href={api.papers.imageUrl(id, img.index)} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={api.papers.imageUrl(id, img.index)} alt={`Page ${img.index + 1}`} loading="lazy" />
                  </a>
                ))}
              </aside>
            </div>
          )}
        </>
      )}
      {portal}
    </div>
  );
}
