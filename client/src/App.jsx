import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { FileSpreadsheet, History, LayoutTemplate, Plus, Sparkles } from 'lucide-react';
import { api, apiProblem } from './api.js';
import CreatePaper from './pages/CreatePaper.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import PaperPage from './pages/PaperPage.jsx';
import TemplateDetail from './pages/TemplateDetail.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import { ErrorBoundary } from './components/Status.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [apiDown, setApiDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const retryTimer = useRef(null);
  const location = useLocation();

  // The layout never waits for the API. If the API can't be reached a banner
  // explains why, and the connection is checked again every 15 seconds.
  const checkHealth = useCallback(async () => {
    clearTimeout(retryTimer.current);
    setChecking(true);
    try {
      setHealth(await api.health());
      setApiDown(false);
    } catch {
      setApiDown(true);
      retryTimer.current = setTimeout(checkHealth, 15000);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    return () => clearTimeout(retryTimer.current);
  }, [checkHealth]);

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

      {apiDown && (
        <div className="banner" role="alert">
          <span>{apiProblem()} Retrying automatically…</span>
          <button type="button" className="banner-btn" onClick={checkHealth} disabled={checking}>
            {checking ? 'Checking…' : 'Retry now'}
          </button>
        </div>
      )}

      <main>
        <ErrorBoundary resetKey={location.pathname}>
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
        </ErrorBoundary>
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
