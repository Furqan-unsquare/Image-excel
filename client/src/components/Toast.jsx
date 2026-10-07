import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message, type = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, message, type }]);
      setTimeout(() => dismiss(id), type === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );

  const icons = { success: CircleCheck, error: CircleX, info: Info };
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon size={18} />
              <span>{t.message}</span>
              <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
