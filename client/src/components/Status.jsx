import { Component, useEffect, useState } from 'react';
import { CircleX, LoaderCircle, RefreshCw } from 'lucide-react';

// Spinner that explains slow first loads: free API hosting (e.g. Render) sleeps
// when idle and can take up to a minute to answer the first request.
export function Loading({ label = 'Loading…' }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="center-msg column">
      <span className="row-actions">
        <LoaderCircle className="spin" size={20} /> {label}
      </span>
      {slow && <span className="muted small">The server may be waking up – this can take up to a minute.</span>}
    </div>
  );
}

// Inline error with a retry button, so a failed request never leaves an empty page.
export function LoadError({ message, onRetry, children }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="alert alert-error load-error">
      <CircleX size={18} />
      <div className="load-error-body">
        <span>{message}</span>
        <span className="row-actions wrap">
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={retry} disabled={busy}>
              <RefreshCw size={15} className={busy ? 'spin' : ''} /> Try again
            </button>
          )}
          {children}
        </span>
      </div>
    </div>
  );
}

// Keeps the header, navigation and footer on screen if a page crashes while rendering.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <LoadError message="Something went wrong while showing this page." onRetry={() => this.setState({ error: null })}>
          <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </LoadError>
      </div>
    );
  }
}
