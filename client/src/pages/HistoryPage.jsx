import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, History, Plus, Trash2 } from 'lucide-react';
import { Loading, LoadError } from '../components/Status.jsx';
import { api, formatDate } from '../api.js';
import { useToast } from '../components/Toast.jsx';

const STATUS = {
  done: ['Ready', 'badge-ok'],
  processing: ['Processing', 'badge-info'],
  failed: ['Failed', 'badge-error'],
};

export default function HistoryPage() {
  const [papers, setPapers] = useState(null);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setPapers(await api.papers.list());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (paper) => {
    if (!window.confirm(`Delete "${paper.title}"?`)) return;
    try {
      await api.papers.remove(paper.id);
      setPapers((list) => list.filter((p) => p.id !== paper.id));
      toast('Paper deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p className="muted">Every converted paper is saved here, so you can open, edit or download it again.</p>
        </div>
        <Link className="btn btn-primary" to="/">
          <Plus size={16} /> New paper
        </Link>
      </div>

      {error && <LoadError message={`Could not load your papers. ${error}`} onRetry={load} />}
      {papers === null && !error && <Loading label="Loading papers…" />}
      {papers?.length === 0 && (
        <div className="card empty">
          <History size={32} />
          <p>No papers yet.</p>
          <Link className="btn btn-primary" to="/">
            Make your first paper
          </Link>
        </div>
      )}
      {papers?.length > 0 && (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Paper</th>
                <th>Format</th>
                <th>Status</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {papers.map((p) => {
                const [label, cls] = STATUS[p.status] || [p.status, ''];
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/papers/${p.id}`} className="strong-link">
                        {p.title}
                      </Link>
                      <div className="muted small">
                        {p.images.length} image{p.images.length === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td>{p.templateName || '—'}</td>
                    <td>
                      <span className={`badge ${cls}`}>{label}</span>
                    </td>
                    <td className="muted small nowrap">{formatDate(p.createdAt)}</td>
                    <td className="nowrap right">
                      {p.status === 'done' && (
                        <a className="icon-btn" href={api.papers.downloadUrl(p.id)} download={p.fileName} title="Download Excel" aria-label="Download Excel">
                          <Download size={17} />
                        </a>
                      )}
                      <button className="icon-btn danger" onClick={() => remove(p)} title="Delete" aria-label="Delete">
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
