// Set VITE_API_URL when the API is hosted on a different domain than the app.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

async function request(path, { method = 'GET', body, json } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      body: json !== undefined ? JSON.stringify(json) : body,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Is the API running?');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

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
    fileUrl: (id) => `${BASE}/api/templates/${id}/file`,
  },

  papers: {
    list: () => request('/papers'),
    get: (id) => request(`/papers/${id}`),
    create: (formData) => request('/papers', { method: 'POST', body: formData }),
    saveContent: (id, json) => request(`/papers/${id}/content`, { method: 'PUT', json }),
    retry: (id, templateId) => request(`/papers/${id}/retry`, { method: 'POST', json: { templateId } }),
    remove: (id) => request(`/papers/${id}`, { method: 'DELETE' }),
    preview: (id) => request(`/papers/${id}/preview`),
    downloadUrl: (id) => `${BASE}/api/papers/${id}/download`,
    imageUrl: (id, index) => `${BASE}/api/papers/${id}/images/${index}`,
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
