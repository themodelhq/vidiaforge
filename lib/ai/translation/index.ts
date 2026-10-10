// VidiaForge — Translation provider factory + ZaiTranslationProvider
// ZaiTranslationProvider uses z-ai-web-dev-sdk LLM to translate texts.
// System prompt: "Translate the following texts from {from} to {to}. Return JSON array of translations only."

import type { TranslationProvider } from './types';
import { TranslationUnavailableError } from './types';

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese',
  ar: 'Arabic', de: 'German', it: 'Italian', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo',
};

function labelFor(code: string): string {
  return LANGUAGE_LABELS[code] || code;
}

export class ZaiTranslationProvider implements TranslationProvider {
  readonly name = 'zai';

  async translate(texts: string[], from: string, to: string): Promise<string[]> {
    if (texts.length === 0) return [];
    const fromLabel = labelFor(from);
    const toLabel = labelFor(to);

    let ZAI: any;
    try {
      const mod: any = await import('z-ai-web-dev-sdk');
      ZAI = mod.default ?? mod.ZAIWebDevSDK;
      if (typeof ZAI?.create !== 'function') {
        throw new Error('z-ai-web-dev-sdk default export has no create()');
      }
    } catch (err) {
      throw new TranslationUnavailableError(
        `z-ai-web-dev-sdk not available: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const zai = await ZAI.create();
    const systemPrompt = `Translate the following texts from ${fromLabel} to ${toLabel}. Return a JSON array of translations only — no commentary, no markdown fences, just the array of strings in the same order as the input.`;
    const userPrompt = JSON.stringify(texts, null, 2);

    let completion: any;
    try {
      completion = await zai.chat.completions.create({
        model: 'glm-4.6',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      } as any);
    } catch (err) {
      throw new TranslationUnavailableError(
        `ZAI chat completion failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const raw: string =
      completion?.choices?.[0]?.message?.content ??
      completion?.choices?.[0]?.message?.reasoning_content ??
      '';

    const translations = parseTranslations(raw, texts.length);
    if (translations.length !== texts.length) {
      // Pad or truncate to match input length
      const padded = translations.slice(0, texts.length);
      while (padded.length < texts.length) padded.push('');
      return padded;
    }
    return translations;
  }
}

function parseTranslations(raw: string, expected: number): string[] {
  if (!raw) return [];
  let text = raw.trim();
  // Strip common markdown fences if present
  if (text.startsWith('```')) {
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }
  // Try to find a JSON array
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    // Fallback: split by newlines
    return text.split(/\n+/).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed.map((p) => (typeof p === 'string' ? p : String(p ?? '')));
    }
  } catch {
    // fall through to line-split
  }
  return text.split(/\n+/).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, expected);
}

let instance: TranslationProvider | null = null;

export function getTranslationProvider(): TranslationProvider {
  if (instance) return instance;
  const name = (process.env.TRANSLATION_PROVIDER || 'zai').toLowerCase();
  if (name === 'zai') {
    instance = new ZaiTranslationProvider();
    return instance;
  }
  throw new TranslationUnavailableError(
    `Unknown TRANSLATION_PROVIDER "${name}". Currently only "zai" is supported.`
  );
}

export type { TranslationProvider } from './types';
export { TranslationUnavailableError, TRANSLATION_LANGUAGES } from './types';
export type { TranslationLanguage } from './types';
