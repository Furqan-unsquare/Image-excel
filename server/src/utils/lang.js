// Hindi / Marathi support: language codes, Devanagari digits, telling Hindi from
// Marathi (both are written in Devanagari) and the words each language uses in a paper.
export const LANGUAGES = ['en', 'hi', 'mr'];
export const LANGUAGE_NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

export const normalizeLanguage = (value, fallback = 'en') => (LANGUAGES.includes(value) ? value : fallback);

const DEVA_DIGITS = '०१२३४५६७८९';
export const toLatinDigits = (text) => String(text ?? '').replace(/[\u0966-\u096F]/g, (d) => String(DEVA_DIGITS.indexOf(d)));
export const toDevanagariDigits = (text) => String(text ?? '').replace(/[0-9]/g, (d) => DEVA_DIGITS[Number(d)]);

export const hasDevanagari = (text) => /[\u0900-\u097F]/.test(String(text ?? ''));

// Printed words in paper.language; also the defaults a format of that language starts with.
export const LANGUAGE_DEFAULTS = {
  en: { questionFormat: 'Q{n}.', answerPrefix: 'Ans: ', inlineMarks: ' ({m} Marks)', optionStyle: 'alpha-lower', digits: 'latin' },
  hi: { questionFormat: 'प्रश्न {n}.', answerPrefix: 'उत्तर : ', inlineMarks: ' ({m} अंक)', optionStyle: 'deva-consonants', digits: 'latin' },
  mr: { questionFormat: 'प्र. {n}.', answerPrefix: 'उत्तर : ', inlineMarks: ' ({m} गुण)', optionStyle: 'deva-digits', digits: 'devanagari' },
};

// Words that are common in Hindi papers and rare in Marathi ones, and the other way round.
const HINDI_WORDS = new Set([
  'है', 'हैं', 'में', 'और', 'नहीं', 'लिखिए', 'कीजिए', 'भरिए', 'बताइए', 'निम्नलिखित', 'अंक', 'कक्षा', 'गलत',
  'यह', 'वह', 'था', 'थी', 'थे', 'किसे', 'कहते', 'क्या', 'किस', 'कौन', 'से', 'को', 'के', 'लिए', 'पूर्णांक', 'चुनकर',
  'शब्दों', 'होती', 'होते', 'कहाँ', 'क्यों', 'इस', 'उस', 'एवं', 'जाता', 'जाती', 'करते', 'करता',
]);
const MARATHI_WORDS = new Set([
  'आहे', 'आहेत', 'आणि', 'नाही', 'लिहा', 'भरा', 'खालील', 'गुण', 'इयत्ता', 'वेळ', 'चूक', 'बरोबर', 'जोड्या',
  'जुळवा', 'निवडा', 'करा', 'द्या', 'कोण', 'कोणते', 'कोणत्या', 'काय', 'मध्ये', 'हे', 'हा', 'व', 'ती', 'ते', 'शब्दात',
  'उत्तरे', 'प्रश्नांची', 'सांगा', 'कोठे', 'असतो', 'असते', 'करतात', 'होते', 'किंवा', 'म्हणजे',
]);
const MARATHI_ENDING = /(च्या|ाचा|ाची|ाचे|ांचा|ांची|ांचे|ाला|ांना|ळ[ाीे]?)$/;

/**
 * Which language a text (OCR result or a format's cells) is in.
 * @returns {{ language: 'en'|'hi'|'mr', sure: boolean, devanagariShare: number }}
 */
export function detectLanguage(text) {
  const s = String(text ?? '');
  const deva = (s.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const devanagariShare = deva + latin ? deva / (deva + latin) : 0;
  if (devanagariShare < 0.3) return { language: 'en', sure: deva + latin > 40, devanagariShare };

  let hi = (s.match(/ड़|ढ़|ड़|ढ़/g) || []).length; // ड़ ढ़
  let mr = (s.match(/ळ/g) || []).length * 2 + (s.match(/ऱ/g) || []).length * 2;
  for (const word of s.split(/[^\u0900-\u0963\u0966-\u097F]+/)) {
    if (!word) continue;
    if (HINDI_WORDS.has(word)) hi += 1;
    if (MARATHI_WORDS.has(word)) mr += 1;
    if (MARATHI_ENDING.test(word)) mr += 1;
  }
  const language = mr > hi ? 'mr' : 'hi';
  return { language, sure: Math.abs(mr - hi) >= 3 && Math.max(mr, hi) >= 2 * Math.min(mr, hi), devanagariShare };
}

// Old Hindi/Marathi fonts that store Devanagari as English letters ("fganh" shows as "हिंदी").
// Unicode text written by the app would show as boxes or wrong letters in them.
export const LEGACY_DEVANAGARI_FONT =
  /kruti|\bdev\s*0\d\d\b|shree[\s-]?(dev|lipi)|shivaji|akruti|walkman|chanakya|devlys|aps[\s-]?dv|\bdv[\s-]?tt|\bkiran\b|shusha/i;
// Unicode Devanagari font present on every Windows PC (and read correctly everywhere else).
export const UNICODE_DEVANAGARI_FONT = 'Nirmala UI';
