import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { FileSpreadsheet, History, LayoutTemplate, Plus, Sparkles } from 'lucide-react';
import { api, apiProblem } from './api.js';
import CreatePaper from './pages/CreatePaper.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import PaperPage from './pages/PaperPage.jsx';
import TemplateDetail from './pages/TemplateDetail.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        setApiDown(false);
      })
      .catch(() => setApiDown(true));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark">
              <FileSpreadsheet size={18} />
            </span>
            PaperSheet
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              <Plus size={16} /> <span>New paper</span>
            </NavLink>
            <NavLink to="/templates">
              <LayoutTemplate size={16} /> <span>Formats</span>
            </NavLink>
            <NavLink to="/history">
              <History size={16} /> <span>History</span>
            </NavLink>
          </nav>
          {health && (
            <span className={`ai-chip ${health.groq ? 'on' : ''}`} title={health.groq ? `Vision: ${health.visionModel} · Text: ${health.textModel}` : 'Set GROQ_API_KEY in server/.env'}>
              <Sparkles size={14} /> {health.groq ? 'AI reading on' : 'Basic OCR'}
            </span>
          )}
        </div>
      </header>

      {apiDown && <div className="banner">{apiProblem()}</div>}

      <main>
        <Routes>
          <Route path="/" element={<CreatePaper health={health} />} />
          <Route path="/papers/:id" element={<PaperPage />} />
          <Route path="/templates" element={<TemplatesPage health={health} />} />
          <Route path="/templates/:id" element={<TemplateDetail health={health} />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route
            path="*"
            element={
              <div className="page">
                <h1>Page not found</h1>
                <NavLink to="/">Go to New paper</NavLink>
              </div>
            }
          />
        </Routes>
      </main>

      <footer className="app-footer">
        Made with{' '}
        <span className="heart" role="img" aria-label="love">
          ❤️
        </span>{' '}
        by{' '}
        <a href="https://frontendgenie.netlify.app/" target="_blank" rel="noopener noreferrer">
          FrontendGenie
        </a>
      </footer>
    </div>
  );
}
