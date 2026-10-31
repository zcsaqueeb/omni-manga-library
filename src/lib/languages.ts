/**
 * Language filter table — shared by the UI dropdown and the source adapters.
 *
 * Each language carries the token spellings the three backends expect:
 *   ia — archive.org advancedsearch `language:` field (ISO 639-2/3, e.g. "hin")
 *   ol — Open Library search `language:` field (MARC/ISO 639-2, e.g. "hin")
 * code — ISO 639-1, used by Gutendex (`languages[]=hi`) and in URLs/UI state.
 *
 * LibriVox + IA Audio Books honour the `ia` token (verified against the live
 * API: collection:librivoxaudio AND language:(hin) → Panchatantra etc.).
 */

export interface LanguageDef {
  /** ISO 639-1 code — used in URLs and the UI state. */
  code: string;
  /** English name shown in the dropdown. */
  label: string;
  /** Native name — shown beside the English label where useful. */
  native?: string;
  /** archive.org language token. */
  ia: string;
  /** Open Library language token (same ISO 639-2 family). */
  ol: string;
}

export const LANGUAGES: LanguageDef[] = [
  { code: "en", label: "English", ia: "eng", ol: "eng" },
  { code: "hi", label: "Hindi", native: "हिन्दी", ia: "hin", ol: "hin" },
  { code: "ur", label: "Urdu", native: "اردو", ia: "urd", ol: "urd" },
  { code: "ar", label: "Arabic", native: "العربية", ia: "ara", ol: "ara" },
  { code: "bn", label: "Bengali", native: "বাংলা", ia: "ben", ol: "ben" },
  { code: "ta", label: "Tamil", native: "தமிழ்", ia: "tam", ol: "tam" },
  { code: "te", label: "Telugu", native: "తెలుగు", ia: "tel", ol: "tel" },
  { code: "mr", label: "Marathi", native: "मराठी", ia: "mar", ol: "mar" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી", ia: "guj", ol: "guj" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ", ia: "pan", ol: "pan" },
  { code: "ml", label: "Malayalam", native: "മലയാളം", ia: "mal", ol: "mal" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ", ia: "kan", ol: "kan" },
  { code: "ne", label: "Nepali", native: "नेपाली", ia: "nep", ol: "nep" },
  { code: "si", label: "Sinhala", native: "සිංහල", ia: "sin", ol: "sin" },
  { code: "fa", label: "Persian", native: "فارسی", ia: "per", ol: "per" },
  { code: "ps", label: "Pashto", native: "پښتو", ia: "pus", ol: "pus" },
  { code: "zh", label: "Chinese", native: "中文", ia: "chi", ol: "chi" },
  { code: "ja", label: "Japanese", native: "日本語", ia: "jpn", ol: "jpn" },
  { code: "ko", label: "Korean", native: "한국어", ia: "kor", ol: "kor" },
  { code: "es", label: "Spanish", native: "Español", ia: "spa", ol: "spa" },
  { code: "fr", label: "French", native: "Français", ia: "fre", ol: "fre" },
  { code: "de", label: "German", native: "Deutsch", ia: "ger", ol: "ger" },
  { code: "it", label: "Italian", native: "Italiano", ia: "ita", ol: "ita" },
  { code: "pt", label: "Portuguese", native: "Português", ia: "por", ol: "por" },
  { code: "ru", label: "Russian", native: "Русский", ia: "rus", ol: "rus" },
  { code: "tr", label: "Turkish", native: "Türkçe", ia: "tur", ol: "tur" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia", ia: "ind", ol: "ind" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt", ia: "vie", ol: "vie" },
  { code: "th", label: "Thai", native: "ไทย", ia: "tha", ol: "tha" },
  { code: "tl", label: "Filipino", native: "Tagalog", ia: "tgl", ol: "tgl" },
  { code: "sw", label: "Swahili", native: "Kiswahili", ia: "swa", ol: "swa" },
  { code: "he", label: "Hebrew", native: "עברית", ia: "heb", ol: "heb" },
  { code: "el", label: "Greek", native: "Ελληνικά", ia: "gre", ol: "gre" },
  { code: "la", label: "Latin", native: "Latina", ia: "lat", ol: "lat" },
  { code: "nl", label: "Dutch", native: "Nederlands", ia: "dut", ol: "dut" },
  { code: "pl", label: "Polish", native: "Polski", ia: "pol", ol: "pol" },
  { code: "uk", label: "Ukrainian", native: "Українська", ia: "ukr", ol: "ukr" },
  { code: "af", label: "Afrikaans", ia: "afr", ol: "afr" },
  { code: "eo", label: "Esperanto", ia: "epo", ol: "epo" },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

/** "hi" → LanguageDef, or undefined for "all"/unknown. */
export function languageDef(code?: string | null): LanguageDef | undefined {
  if (!code || code === "all") return undefined;
  return LANGUAGES.find((l) => l.code === code);
}

/** Validate a raw `lang` query param → clean code or undefined. */
export function sanitizeLang(raw?: string | null): string | undefined {
  return languageDef(raw)?.code;
}

/** archive.org language clause — matches both the ISO token and the spelled-out
 * name (older IA items use "hindi"/"urdu", newer ones "hin"/"urd"):
 * e.g. ` AND (language:(hin) OR language:(hindi))`. */
export function iaLangClause(code?: string | null): string {
  const def = languageDef(code);
  if (!def) return "";
  const name = def.label.toLowerCase();
  return name === def.ia
    ? ` AND language:(${def.ia})`
    : ` AND (language:(${def.ia}) OR language:(${name}))`;
}
