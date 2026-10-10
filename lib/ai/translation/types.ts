// VidiaForge — Translation provider interface.
// Used to translate caption cues between languages synchronously (short text).

export type TranslationLanguage =
  | 'en' | 'fr' | 'es' | 'pt' | 'ar' | 'de' | 'it' | 'zh' | 'ja' | 'ko' | 'yo' | 'ha' | 'ig';

export const TRANSLATION_LANGUAGES: { code: TranslationLanguage; label: string; nativeName: string }[] = [
  { code: 'en', label: 'English', nativeName: 'English' },
  { code: 'fr', label: 'French', nativeName: 'Français' },
  { code: 'es', label: 'Spanish', nativeName: 'Español' },
  { code: 'pt', label: 'Portuguese', nativeName: 'Português' },
  { code: 'ar', label: 'Arabic', nativeName: 'العربية' },
  { code: 'de', label: 'German', nativeName: 'Deutsch' },
  { code: 'it', label: 'Italian', nativeName: 'Italiano' },
  { code: 'zh', label: 'Chinese', nativeName: '中文' },
  { code: 'ja', label: 'Japanese', nativeName: '日本語' },
  { code: 'ko', label: 'Korean', nativeName: '한국어' },
  { code: 'yo', label: 'Yoruba', nativeName: 'Yorùbá' },
  { code: 'ha', label: 'Hausa', nativeName: 'Hausa' },
  { code: 'ig', label: 'Igbo', nativeName: 'Igbo' },
];

export class TranslationUnavailableError extends Error {
  readonly code = 'TRANSLATION_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'TranslationUnavailableError';
  }
}

export interface TranslationProvider {
  readonly name: string;
  translate(texts: string[], from: string, to: string): Promise<string[]>;
}
