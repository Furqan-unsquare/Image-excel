const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n) {
  let out = '';
  let rest = Math.max(1, Math.floor(n));
  for (const [value, symbol] of ROMAN) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

export function fromRoman(text) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const s = String(text || '').toUpperCase();
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = map[s[i]];
    const next = map[s[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return toRoman(total) === s ? total : null;
}

export function toAlpha(n) {
  let out = '';
  let rest = Math.max(1, Math.floor(n));
  while (rest > 0) {
    const r = (rest - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

// arabic | alpha-lower | alpha-upper | roman-lower | roman-upper
export function detectNumberStyle(token) {
  const t = String(token || '');
  if (/^\d+$/.test(t)) return 'arabic';
  if (/^[ivxlc]{2,}$/.test(t) && fromRoman(t)) return 'roman-lower';
  if (/^[IVXLC]{2,}$/.test(t) && fromRoman(t)) return 'roman-upper';
  if (t === 'i') return 'roman-lower';
  if (t === 'I') return 'roman-upper';
  if (/^[a-z]$/.test(t)) return 'alpha-lower';
  if (/^[A-Z]$/.test(t)) return 'alpha-upper';
  return 'arabic';
}

export function formatNumber(n, style = 'arabic') {
  switch (style) {
    case 'alpha-lower':
      return toAlpha(n).toLowerCase();
    case 'alpha-upper':
      return toAlpha(n);
    case 'roman-lower':
      return toRoman(n).toLowerCase();
    case 'roman-upper':
      return toRoman(n);
    default:
      return String(n);
  }
}

// Turns a label as written in the source ("4", "IV", "b", "6]") into a number.
export function labelToNumber(label) {
  const t = String(label || '').replace(/[^0-9A-Za-z]/g, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const roman = fromRoman(t);
  if (roman && t.length > 1) return roman;
  if (/^[A-Za-z]$/.test(t)) return t.toUpperCase().charCodeAt(0) - 64;
  return roman;
}
