// /api/ai/translate — POST { cues[], from, to }
// Calls getTranslationProvider() directly (synchronous — short text, no queue needed).
// Returns { translatedCues }.
//
// S2: when the provider isn't configured (z-ai-web-dev-sdk missing OR
// TRANSLATION_PROVIDER set to an unknown name), returns 503 with
// TRANSLATION_PROVIDER_NOT_CONFIGURED so the frontend can render a friendly
// "Translation requires an AI provider" message.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getTranslationProvider } from '@/lib/ai/translation';
import { TranslationUnavailableError } from '@/lib/ai/translation';
import { ERROR_CODES } from '@/lib/errors/codes';
import type { CaptionCue } from '@/lib/types';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const cues = Array.isArray(body?.cues) ? body.cues : null;
  const from = typeof body?.from === 'string' ? body.from : null;
  const to = typeof body?.to === 'string' ? body.to : null;

  if (!cues || !from || !to) {
    return NextResponse.json({ error: 'cues (array), from, to required' }, { status: 400 });
  }
  if (cues.length === 0) {
    return NextResponse.json({ translatedCues: [] });
  }
  if (cues.length > 500) {
    return NextResponse.json({ error: 'Too many cues (max 500 per request)' }, { status: 400 });
  }

  const texts = cues.map((c: any) => (typeof c?.text === 'string' ? c.text : ''));

  let provider;
  try {
    provider = getTranslationProvider();
  } catch (err) {
    // S2: include the stable error code so the frontend can switch on it.
    return NextResponse.json(
      {
        error: err instanceof TranslationUnavailableError
          ? err.message
          : 'Translation provider not configured.',
        code: ERROR_CODES.TRANSLATION_PROVIDER_NOT_CONFIGURED,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }

  try {
    const translated = await provider.translate(texts, from, to);
    const translatedCues: CaptionCue[] = cues.map((c: any, i: number) => ({
      id: typeof c.id === 'string' ? `${c.id}_${to}` : `cue_${i}_${to}`,
      start: Number(c.start ?? 0),
      end: Number(c.end ?? 0),
      text: translated[i] ?? '',
      speaker: typeof c.speaker === 'string' ? c.speaker : undefined,
      words: Array.isArray(c.words) ? c.words : undefined,
    }));
    return NextResponse.json({ translatedCues, from, to });
  } catch (err) {
    const isUnavailable = err instanceof TranslationUnavailableError;
    return NextResponse.json(
      {
        error: isUnavailable
          ? err.message
          : 'Translation failed.',
        code: isUnavailable
          ? ERROR_CODES.TRANSLATION_PROVIDER_NOT_CONFIGURED
          : ERROR_CODES.AI_PROVIDER_ERROR,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: isUnavailable ? 503 : 500 }
    );
  }
}
