import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, LoaderCircle, Plus } from 'lucide-react';
import { api } from '../api.js';
import TemplateCard from '../components/TemplateCard.jsx';
import UploadTemplateDialog from '../components/UploadTemplateDialog.jsx';
import { useToast } from '../components/Toast.jsx';

export default function TemplatesPage({ health }) {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.templates.list().then(setTemplates).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page templates-page">
      <div className="page-head">
        <div>
          <h1>Formats</h1>
          <p className="muted">
            Each format is a sample Excel paper. Its header, fonts, columns, question/marks style and spacing are reused
            for every new paper. Open a format to check or adjust what was detected.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          <Plus size={16} /> Upload format
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {templates === null && !error && (
        <div className="center-msg">
          <LoaderCircle className="spin" size={20} /> Loading…
        </div>
      )}
      {templates?.length === 0 && (
        <div className="card empty">
          <FileSpreadsheet size={32} />
          <p>No formats yet.</p>
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            <Plus size={16} /> Upload format
          </button>
        </div>
      )}
      {templates?.length > 0 && (
        <div className="template-grid">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onSelect={() => navigate(`/templates/${t.id}`)}
              footer={
                <div className="muted small">
                  Used {t.usageCount || 0} time{t.usageCount === 1 ? '' : 's'}
                  {t.isSample ? ' · sample' : ''}
                </div>
              }
            />
          ))}
        </div>
      )}

      {uploadOpen && (
        <UploadTemplateDialog
          aiAvailable={health?.groq}
          onClose={() => setUploadOpen(false)}
          onCreated={(t) => {
            setUploadOpen(false);
            toast(`Format "${t.name}" saved`);
            navigate(`/templates/${t.id}`);
          }}
        />
      )}
    </div>
  );
}
