// VidiaForge V19.1 §4.5 — Audio catalog provider unit tests
//
// V19.1 §4.5 — Acceptance: "The music library does not present
// generated test tones as real music."
//
// These tests verify:
//   - The built-in SFX provider returns the 8 real noise-based SFX
//     WAVs shipped under /public/audio/.
//   - The built-in SFX provider returns an EMPTY list for music —
//     it does NOT present test tones as music.
//   - The default external music provider (no env var configured)
//     returns an empty music list (honest empty state).
//   - Each SFX entry has a real duration (not 0) and points at a real
//     file on disk.
//
// These tests don't require a database or Redis — they exercise the
// pure TypeScript provider code + read the real SFX files.

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { existsSync, statSync } from 'fs';
import path from 'path';
import {
  createBuiltinSfxProvider,
  createExternalMusicProvider,
  describeExternalMusicProvider,
} from '../../src/lib/audio';
import { getAudioProvider } from '../../src/lib/audio';

const PUBLIC_AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');

describe('V19.1 §4.2 — Built-in SFX provider', () => {
  const provider = createBuiltinSfxProvider();

  test('is always configured', () => {
    expect(provider.configured).toBe(true);
  });

  test('returns 8 real SFX assets', async () => {
    const sfx = await provider.listSfx();
    expect(sfx.length).toBe(8);
  });

  test('REGRESSION: returns an EMPTY list for music (no fake tones)', async () => {
    // V19.1 §4.5 — the bug: the previous audio panel shipped sine tones
    // as "music" with fabricated titles like "Sunset Drive" and "Afro
    // Pulse". The builtin SFX provider must NOT do this — it only
    // returns SFX.
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('every SFX entry has a stable id + title + category', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(typeof track.id).toBe('string');
      expect(track.id.length).toBeGreaterThan(0);
      expect(typeof track.title).toBe('string');
      expect(track.title.length).toBeGreaterThan(0);
      expect(typeof track.category).toBe('string');
      expect(track.category.length).toBeGreaterThan(0);
    }
  });

  test('every SFX entry has a real duration > 0 (no fabricated durations)', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.duration).toBeGreaterThan(0);
      expect(isFinite(track.duration)).toBe(true);
    }
  });

  test('every SFX entry points at a real file on disk', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      // The `url` is a public path like "/audio/sfx-1-whoosh.wav".
      // In Next.js, files under /public/ are served at the root, so
      // /audio/X.wav maps to public/audio/X.wav on disk.
      const relPath = track.url.replace(/^\//, 'public/');
      const absPath = path.join(process.cwd(), relPath);
      expect(existsSync(absPath)).toBe(true);
      const stat = statSync(absPath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('every SFX entry reports `available: true` (file is readable)', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.available).toBe(true);
      expect(track.previewAvailable).toBe(true);
    }
  });

  test('every SFX entry is CC0 licensed (no attribution required)', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.licenseType).toBe('CC0');
      expect(track.attributionRequired).toBe(false);
    }
  });

  test('getById returns the correct SFX by stable id', async () => {
    const track = await provider.getById('sfx-whoosh');
    expect(track).not.toBe(null);
    expect(track!.id).toBe('sfx-whoosh');
    expect(track!.title).toBe('Whoosh');
  });

  test('getById returns null for an unknown id', async () => {
    const track = await provider.getById('nonexistent-id');
    expect(track).toBe(null);
  });
});

describe('V19.1 §4.2 — External music provider (default = none)', () => {
  // V19.1 §4.5: when no AUDIO_PROVIDER env var is set, the external
  // provider is "none" and returns an empty music list — the honest
  // empty state. The UI shows "No music catalog configured" rather
  // than fake tracks.

  // Save + restore env so the test doesn't leak state.
  const prevProvider = process.env.AUDIO_PROVIDER;
  beforeEach(() => {
    delete process.env.AUDIO_PROVIDER;
  });
  afterEach(() => {
    if (prevProvider !== undefined) process.env.AUDIO_PROVIDER = prevProvider;
    else delete process.env.AUDIO_PROVIDER;
  });

  test('default external provider is "none" (not configured)', () => {
    const provider = createExternalMusicProvider();
    expect(provider.configured).toBe(false);
    expect(provider.name).toBe('external-none');
  });

  test('default external provider returns EMPTY music list', async () => {
    const provider = createExternalMusicProvider();
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('describeExternalMusicProvider reports "not configured"', () => {
    const desc = describeExternalMusicProvider();
    expect(desc.configured).toBe(false);
    expect(desc.name).toBe('external-none');
  });
});

describe('V19.1 §4.2 — Aggregate audio provider (getAudioProvider)', () => {
  test('returns a singleton (cached across calls)', () => {
    const a = getAudioProvider();
    const b = getAudioProvider();
    expect(a).toBe(b); // referential equality — same instance
  });

  test('listSfx returns the 8 built-in SFX', async () => {
    const provider = getAudioProvider();
    const sfx = await provider.listSfx();
    expect(sfx.length).toBe(8);
  });

  test('listMusic returns an empty list (no external provider configured)', async () => {
    const provider = getAudioProvider();
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('getById finds SFX by id', async () => {
    const provider = getAudioProvider();
    const track = await provider.getById('sfx-impact');
    expect(track).not.toBe(null);
    expect(track!.id).toBe('sfx-impact');
  });

  test('getById returns null for an unknown music id', async () => {
    const provider = getAudioProvider();
    const track = await provider.getById('music-nonexistent');
    expect(track).toBe(null);
  });
});

describe('V19.1 §4.5 — REGRESSION: "music catalog does not present test tones as real music"', () => {
  // V19.1 §4.5 — Acceptance criteria. The previous implementation
  // shipped sine tones as "music" with fabricated artist/bpm/mood
  // metadata. The new implementation MUST NOT do this.

  test('the built-in SFX provider\'s listMusic() is empty', async () => {
    const provider = createBuiltinSfxProvider();
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('the default external provider\'s listMusic() is empty', async () => {
    delete process.env.AUDIO_PROVIDER;
    const provider = createExternalMusicProvider();
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('the aggregate provider\'s listMusic() is empty (no external configured)', async () => {
    delete process.env.AUDIO_PROVIDER;
    const provider = getAudioProvider();
    const music = await provider.listMusic();
    expect(music).toEqual([]);
  });

  test('no SFX track masquerades as music (every SFX has source=builtin-sfx)', async () => {
    const provider = createBuiltinSfxProvider();
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.source).toBe('builtin-sfx');
    }
  });
});
