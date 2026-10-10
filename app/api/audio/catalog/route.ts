// /api/audio/catalog — GET (list real audio assets)
//
// V19.1 §4.2 — Real audio catalog endpoint.
//
// Query params:
//   - type: 'music' | 'sfx' | 'all' (default 'all')
//   - q: search query (matches title + category + mood)
//   - category: filter by category
//
// Response:
//   {
//     music: AudioMetadata[],   // empty when no external provider configured
//     sfx: AudioMetadata[],     // always non-empty (built-in SFX)
//     provider: { name, configured },  // human-readable source description
//   }
//
// V19.1 §4.5 — Acceptance: "The music library does not present generated
// test tones as real music." This endpoint NEVER returns test tones as
// music. When no external provider is configured, `music` is empty and
// the frontend renders an honest empty state.

import { NextResponse } from 'next/server';
import { getAudioProvider, describeExternalMusicProvider } from '@/lib/audio';

export const runtime = 'nodejs'; // FFprobe is sync + needs fs access

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = (url.searchParams.get('type') || 'all').toLowerCase();
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const category = (url.searchParams.get('category') || '').toLowerCase().trim();

  const provider = getAudioProvider();
  const external = describeExternalMusicProvider();

  // V19.1 §4.2: fetch the catalog. Failures in the external provider
  // are swallowed inside the aggregate provider (returns [] on error),
  // so the catalog endpoint stays resilient.
  const [music, sfx] = await Promise.all([
    provider.listMusic(),
    provider.listSfx(),
  ]);

  // V19.1 §4.3: filter by query + category
  function matches(track: { title: string; category: string; mood: string; artist: string }): boolean {
    if (q) {
      const haystack = `${track.title} ${track.category} ${track.mood} ${track.artist}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (category && track.category.toLowerCase() !== category) return false;
    return true;
  }

  const filteredMusic = music.filter(matches);
  const filteredSfx = sfx.filter(matches);

  let musicOut: typeof filteredMusic = filteredMusic;
  let sfxOut: typeof filteredSfx = filteredSfx;
  if (type === 'music') sfxOut = [];
  if (type === 'sfx') musicOut = [];

  return NextResponse.json({
    music: musicOut,
    sfx: sfxOut,
    provider: {
      // Aggregate provider name (always "aggregate")
      name: provider.name,
      configured: provider.configured,
      // External music provider specifics — used by the UI to show
      // "Music source: not configured" vs "Music source: mubert"
      external: {
        name: external.name,
        configured: external.configured,
      },
    },
  });
}
