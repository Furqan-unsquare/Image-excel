// Paper languages. Each format (Excel template) belongs to one language and photos
// are read in the language of the format they are converted with.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिंदी' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
];

export const languageOf = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];

// "हिंदी · Hindi", or just "English".
export const languageLabel = (code) => {
  const l = languageOf(code);
  return l.native === l.name ? l.name : `${l.native} · ${l.name}`;
};

// What a format of this language usually looks like (shown when none is uploaded yet).
export const FORMAT_EXAMPLES = {
  en: '“Subject:”, “Std:”, “Q1.”, “(2 Marks)”',
  hi: '“विषय :”, “कक्षा :”, “प्रश्न 1.”, “(2 अंक)”',
  mr: '“विषय :”, “इयत्ता :”, “प्र. १.”, “(२ गुण)”',
};
