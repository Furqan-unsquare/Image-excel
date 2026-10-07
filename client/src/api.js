// Where the API lives.
// - Development: leave VITE_API_URL empty; Vite forwards /api to the local server.
// - Production: set VITE_API_URL to the server's address (e.g. https://api.myschool.com)
//   in client/.env.production or in the hosting dashboard, then build.
// "https://x.com", "https://x.com/" and "https://x.com/api" all work.
export const API_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');

const notConfigured = () =>
  import.meta.env.DEV
    ? 'Cannot reach the API server. Start it with "npm run dev" in the server folder.'
    : `Cannot reach the API server${API_BASE ? ` at ${API_BASE}` : ''}. ${
        API_BASE ? 'Check that it is running and that its CORS_ORIGIN allows this site.' : 'Set VITE_API_URL to the server address and build again.'
      }`;

async function request(path, { method = 'GET', body, json } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      body: json !== undefined ? JSON.stringify(json) : body,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new Error(notConfigured());
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  // Every API route answers with JSON. Anything else (usually the static host's
  // index.html) means the request never reached the API.
  if (!isJson) throw new Error(res.status === 413 ? "The upload is too large for the server." : notConfigured());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const apiProblem = notConfigured;

export const api = {
  health: () => request('/health'),

  templates: {
    list: () => request('/templates'),
    get: (id) => request(`/templates/${id}`),
    create: (formData) => request('/templates', { method: 'POST', body: formData }),
    update: (id, json) => request(`/templates/${id}`, { method: 'PATCH', json }),
    reanalyze: (id, useAi) => request(`/templates/${id}/reanalyze`, { method: 'POST', json: { useAi } }),
    remove: (id) => request(`/templates/${id}`, { method: 'DELETE' }),
    preview: (id) => request(`/templates/${id}/preview`),
    samplePreview: (id) => request(`/templates/${id}/sample-preview`),
    fileUrl: (id) => `${API_BASE}/api/templates/${id}/file`,
  },

  papers: {
    list: () => request('/papers'),
    get: (id) => request(`/papers/${id}`),
    create: (formData) => request('/papers', { method: 'POST', body: formData }),
    saveContent: (id, json) => request(`/papers/${id}/content`, { method: 'PUT', json }),
    retry: (id, templateId) => request(`/papers/${id}/retry`, { method: 'POST', json: { templateId } }),
    remove: (id) => request(`/papers/${id}`, { method: 'DELETE' }),
    preview: (id) => request(`/papers/${id}/preview`),
    downloadUrl: (id) => `${API_BASE}/api/papers/${id}/download`,
    imageUrl: (id, index) => `${API_BASE}/api/papers/${id}/images/${index}`,
  },
};

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const colLetter = (index) => {
  let n = Number(index) || 0;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
