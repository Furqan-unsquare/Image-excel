import { toDevanagariDigits, toLatinDigits } from './lang.js';

const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

// Devanagari letter numbering used in Hindi / Marathi papers.
// deva-abcd: अ ब स द (Hindi "a b c d"), deva-vowels: अ आ इ ई (Marathi), deva-consonants: क ख ग घ (Hindi options).
export const DEVA_SERIES = {
  'deva-abcd': ['अ', 'ब', 'स', 'द', 'इ', 'फ', 'ग', 'ह'],
  'deva-vowels': ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'अं', 'अः'],
  'deva-consonants': ['क', 'ख', 'ग', 'घ', 'ङ', 'च', 'छ', 'ज', 'झ', 'ञ', 'ट', 'ठ', 'ड', 'ढ', 'ण', 'त', 'थ', 'द', 'ध', 'न', 'प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'श', 'ष', 'स', 'ह'],
};

export const NUMBER_STYLES = ['arabic', 'alpha-lower', 'alpha-upper', 'roman-lower', 'roman-upper', 'deva-digits', ...Object.keys(DEVA_SERIES)];

const DEVA_LETTER_RE = /^[\u0904-\u0939](?:[ंः])?$/;

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

// Marathi ordinal after a question number: प्र. १ ला, २ रा, ३ रा, ४ था, ५ वा …
export const marathiOrdinal = (n) => (n === 1 ? 'ला' : n === 2 || n === 3 ? 'रा' : n === 4 ? 'था' : 'वा');

// Keeps letters and digits of any script, drops brackets, dots and the danda.
const cleanLabel = (label) => String(label || '').replace(/[^0-9A-Za-z\u0900-\u0963\u0966-\u096F\u0971-\u097F]/g, '');

// The Devanagari letter series that explains all the given labels best.
// "इ" is the 3rd vowel but the 5th letter of अ ब स द इ, so one label alone is not enough.
export function devaSeriesFor(tokens) {
  const letters = tokens.map(cleanLabel).filter((t) => DEVA_LETTER_RE.test(t));
  if (!letters.length) return null;
  const order = ['deva-abcd', 'deva-vowels', 'deva-consonants'];
  const fits = order.filter((key) => letters.every((l) => DEVA_SERIES[key].includes(l)));
  const increasing = fits.find((key) => {
    const idx = letters.map((l) => DEVA_SERIES[key].indexOf(l));
    return idx.every((v, i) => i === 0 || v >= idx[i - 1]);
  });
  return increasing || fits[0] || null;
}

// arabic | alpha-lower | alpha-upper | roman-lower | roman-upper | deva-digits | deva-abcd | deva-vowels | deva-consonants
export function detectNumberStyle(token) {
  const t = cleanLabel(token);
  if (/^\d+$/.test(t)) return 'arabic';
  if (/^[\u0966-\u096F]+$/.test(t)) return 'deva-digits';
  if (DEVA_LETTER_RE.test(t)) return devaSeriesFor([t]) || 'deva-abcd';
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
    case 'deva-digits':
      return toDevanagariDigits(String(n));
    default:
      if (DEVA_SERIES[style]) return DEVA_SERIES[style][n - 1] || toDevanagariDigits(String(n));
      return String(n);
  }
}

// Turns a label as written in the source ("4", "IV", "b", "6]", "४", "(ब)") into a number.
// `series` says which Devanagari letter series the label belongs to (see devaSeriesFor).
export function labelToNumber(label, series = null) {
  const t = toLatinDigits(cleanLabel(label));
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (DEVA_LETTER_RE.test(t)) {
    const key = series && DEVA_SERIES[series] ? series : devaSeriesFor([t]);
    const index = key ? DEVA_SERIES[key].indexOf(t) : -1;
    return index >= 0 ? index + 1 : null;
  }
  const roman = fromRoman(t);
  if (roman && t.length > 1) return roman;
  if (/^[A-Za-z]$/.test(t)) return t.toUpperCase().charCodeAt(0) - 64;
  return roman;
}

// Numbers for a list of sibling labels (the sub-questions of one question).
export function labelNumbers(labels) {
  const series = devaSeriesFor(labels);
  return labels.map((l) => labelToNumber(l, series));
}
