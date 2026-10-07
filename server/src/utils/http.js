export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || ''));

export function safeFileName(name, fallback = 'paper') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}
