// VidiaForge V19.1 §4.2 — Audio provider contract tests
//
// V19.1 PHASE 2 — REAL PROVIDER VERIFICATION (with recorded fixtures).
//
// These tests verify the parsing + validation logic of the Internet Archive
// and Jamendo audio providers WITHOUT requiring live API access. They use
// recorded fixtures that match the actual API response shapes:
//   - tests/fixtures/audio/api-responses/internet-archive-search.json
//   - tests/fixtures/audio/api-responses/internet-archive-metadata-{001,002,003,007}.json
//   - tests/fixtures/audio/api-responses/jamendo-tracks.json
//
// What these tests verify:
//   1. The provider factory selects the right provider based on AUDIO_PROVIDER.
//   2. Internet Archive license parsing accepts CC-BY, CC-BY-SA, CC0, Public Domain
//      and rejects CC-BY-NC, CC-BY-ND, empty, and unknown licenses.
//   3. Internet Archive duration parsing handles "HH:MM:SS", "MM:SS", "SS", and "SS.mmm".
//   4. Internet Archive item metadata parsing extracts the correct title, creator,
//      license, file URL, and duration from a recorded fixture.
//   5. Jamendo license + track parsing accepts CC-BY, CC-BY-SA, CC0 and rejects
//      CC-BY-NC + empty licenses.
//   6. Jamendo track-to-metadata conversion produces a valid AudioMetadata object.
//   7. Category classification maps titles/descriptions to the V19.1 categories.
//
// What these tests do NOT verify (BLOCKED):
//   - Live API calls to https://archive.org or https://api.jamendo.com
//     (the sandbox has no internet egress; live verification is BLOCKED until
//      the deployment has internet + the relevant credentials).
//   - Network timeout handling (would require a mock fetch that hangs).
//
// Live-integration verification will be added once the deployment has
// internet egress + the JAMENDO_CLIENT_ID credential. The Internet Archive
// adapter needs no credentials (public API).

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import {
  createExternalMusicProvider,
  createInternetArchiveProvider,
  createJamendoProvider,
} from '../../src/lib/audio';
import {
  __testInternals as iaInternals,
} from '../../src/lib/audio/internet-archive-provider';
import {
  __testInternals as jamendoInternals,
} from '../../src/lib/audio/jamendo-provider';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'audio', 'api-responses');

function loadFixture(name: string): unknown {
  const p = path.join(FIXTURES_DIR, name);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

// ============================================================================
// 1. Provider factory selection
// ============================================================================

describe('V19.1 §4.2 — Provider factory selection', () => {
  const prevProvider = process.env.AUDIO_PROVIDER;
  beforeEach(() => { delete process.env.AUDIO_PROVIDER; });
  afterEach(() => {
    if (prevProvider !== undefined) process.env.AUDIO_PROVIDER = prevProvider;
    else delete process.env.AUDIO_PROVIDER;
  });

  test('default (no env var) → external-none provider', () => {
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-none');
    expect(p.configured).toBe(false);
  });

  test('AUDIO_PROVIDER=none → external-none provider', () => {
    process.env.AUDIO_PROVIDER = 'none';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-none');
    expect(p.configured).toBe(false);
  });

  test('AUDIO_PROVIDER=internet-archive → Internet Archive provider (configured)', () => {
    process.env.AUDIO_PROVIDER = 'internet-archive';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-internet-archive');
    expect(p.configured).toBe(true);
  });

  test('AUDIO_PROVIDER=ia → Internet Archive provider (alias)', () => {
    process.env.AUDIO_PROVIDER = 'ia';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-internet-archive');
    expect(p.configured).toBe(true);
  });

  test('AUDIO_PROVIDER=jamendo (no JAMENDO_CLIENT_ID) → Jamendo provider (NOT configured)', () => {
    delete process.env.JAMENDO_CLIENT_ID;
    process.env.AUDIO_PROVIDER = 'jamendo';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-jamendo');
    expect(p.configured).toBe(false);
  });

  test('AUDIO_PROVIDER=jamendo + JAMENDO_CLIENT_ID → Jamendo provider (configured)', () => {
    process.env.AUDIO_PROVIDER = 'jamendo';
    process.env.JAMENDO_CLIENT_ID = 'test-client-id-fixture';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-jamendo');
    expect(p.configured).toBe(true);
    delete process.env.JAMENDO_CLIENT_ID;
  });

  test('AUDIO_PROVIDER=unknown-foo → falls back to none (honest default)', () => {
    process.env.AUDIO_PROVIDER = 'unknown-foo';
    const p = createExternalMusicProvider();
    expect(p.name).toBe('external-none');
    expect(p.configured).toBe(false);
  });
});

// ============================================================================
// 2. Internet Archive — license parsing
// ============================================================================

describe('V19.1 §4.2 — Internet Archive license parsing', () => {
  const { parseIaLicense } = iaInternals;

  test('CC-BY 4.0 → accepted, attribution required', () => {
    const r = parseIaLicense('https://creativecommons.org/licenses/by/4.0/');
    expect(r).not.toBeNull();
    expect(r!.licenseType).toBe('CC-BY 4.0');
    expect(r!.attributionRequired).toBe(true);
  });

  test('CC-BY 3.0 → accepted (any version)', () => {
    const r = parseIaLicense('https://creativecommons.org/licenses/by/3.0/');
    expect(r).not.toBeNull();
    expect(r!.licenseType).toBe('CC-BY 3.0');
    expect(r!.attributionRequired).toBe(true);
  });

  test('CC-BY-SA 4.0 → accepted (share-alike, commercial OK)', () => {
    const r = parseIaLicense('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(r).not.toBeNull();
    expect(r!.licenseType).toBe('CC-BY-SA 4.0');
    expect(r!.attributionRequired).toBe(true);
  });

  test('Public Domain mark → accepted, no attribution', () => {
    const r = parseIaLicense('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(r).not.toBeNull();
    expect(r!.licenseType).toBe('Public Domain');
    expect(r!.attributionRequired).toBe(false);
  });

  test('CC0 1.0 → accepted, no attribution', () => {
    const r = parseIaLicense('http://creativecommons.org/publicdomain/zero/1.0/');
    expect(r).not.toBeNull();
    expect(r!.licenseType).toBe('CC0');
    expect(r!.attributionRequired).toBe(false);
  });

  test('CC-BY-NC 4.0 → REJECTED (non-commercial, not suitable for monetized UGC)', () => {
    const r = parseIaLicense('https://creativecommons.org/licenses/by-nc/4.0/');
    expect(r).toBeNull();
  });

  test('CC-BY-ND 4.0 → REJECTED (no derivatives)', () => {
    const r = parseIaLicense('https://creativecommons.org/licenses/by-nd/4.0/');
    expect(r).toBeNull();
  });

  test('empty string → REJECTED', () => {
    expect(parseIaLicense('')).toBeNull();
  });

  test('undefined → REJECTED', () => {
    expect(parseIaLicense(undefined)).toBeNull();
  });

  test('null → REJECTED', () => {
    expect(parseIaLicense(null)).toBeNull();
  });

  test('non-CC URL (all rights reserved) → REJECTED', () => {
    expect(parseIaLicense('https://example.com/all-rights-reserved')).toBeNull();
  });
});

// ============================================================================
// 3. Internet Archive — duration parsing
// ============================================================================

describe('V19.1 §4.2 — Internet Archive duration parsing', () => {
  const { parseIaDuration } = iaInternals;

  test('"3:24" (MM:SS) → 204 seconds', () => {
    expect(parseIaDuration('3:24')).toBe(204);
  });

  test('"1:23:45" (HH:MM:SS) → 5025 seconds', () => {
    expect(parseIaDuration('1:23:45')).toBe(1 * 3600 + 23 * 60 + 45);
  });

  test('"204" (SS) → 204 seconds', () => {
    expect(parseIaDuration('204')).toBe(204);
  });

  test('"204.5" (SS.mmm) → 204.5 seconds', () => {
    expect(parseIaDuration('204.5')).toBeCloseTo(204.5, 1);
  });

  test('"5:00" → 300 seconds', () => {
    expect(parseIaDuration('5:00')).toBe(300);
  });

  test('empty string → 0', () => {
    expect(parseIaDuration('')).toBe(0);
  });

  test('undefined → 0', () => {
    expect(parseIaDuration(undefined)).toBe(0);
  });

  test('garbage string → 0', () => {
    expect(parseIaDuration('not-a-duration')).toBe(0);
  });
});

// ============================================================================
// 4. Internet Archive — file selection
// ============================================================================

describe('V19.1 §4.2 — Internet Archive MP3 file selection', () => {
  const { pickBestMp3File } = iaInternals;

  test('prefers VBR MP3 with a non-empty duration', () => {
    const files = [
      { name: 'track.flac', format: 'Flac', size: '100', length: '3:00' },
      { name: 'track.mp3', format: 'VBR MP3', size: '100', length: '3:00' },
    ];
    const f = pickBestMp3File(files as any);
    expect(f).not.toBeNull();
    expect(f!.name).toBe('track.mp3');
  });

  test('falls back to any MP3 format', () => {
    const files = [
      { name: 'track.mp3', format: 'MP3', size: '100', length: '3:00' },
    ];
    const f = pickBestMp3File(files as any);
    expect(f).not.toBeNull();
    expect(f!.name).toBe('track.mp3');
  });

  test('returns null when no MP3 file exists', () => {
    const files = [
      { name: 'track.flac', format: 'Flac', size: '100', length: '3:00' },
    ];
    expect(pickBestMp3File(files as any)).toBeNull();
  });

  test('returns null for an empty file list', () => {
    expect(pickBestMp3File([])).toBeNull();
  });
});

// ============================================================================
// 5. Internet Archive — category classification
// ============================================================================

describe('V19.1 §4.2 — Internet Archive category classification', () => {
  const { classifyCategory } = iaInternals;

  test('"cinematic film score" → Cinematic / Dramatic', () => {
    const r = classifyCategory('Cinematic Film Score', 'epic orchestral');
    expect(r.category).toBe('Cinematic');
    expect(r.mood).toBe('Dramatic');
  });

  test('"ambient atmospheric drone" → Ambient / Atmospheric', () => {
    const r = classifyCategory('Ambient Drone', 'atmospheric soundscape');
    expect(r.category).toBe('Ambient');
  });

  test('"upbeat happy pop" → Upbeat / Energetic', () => {
    const r = classifyCategory('Upbeat Pop', 'happy energetic');
    expect(r.category).toBe('Upbeat');
  });

  test('"calm meditation peaceful" → Calm / Relaxed', () => {
    const r = classifyCategory('Calm Meditation', 'peaceful soothing');
    expect(r.category).toBe('Calm');
  });

  test('"travel adventure journey" → Travel / Adventurous', () => {
    const r = classifyCategory('Travel Montage', 'adventure journey road trip');
    expect(r.category).toBe('Travel');
  });

  test('unrecognized → defaults to Instrumental / Musical', () => {
    const r = classifyCategory('Mystery Title', 'no keywords');
    expect(r.category).toBe('Instrumental');
  });
});

// ============================================================================
// 6. Internet Archive — end-to-end fixture parsing (no live API call)
// ============================================================================

describe('V19.1 §4.2 — Internet Archive fixture-based item parsing', () => {
  // These tests parse the recorded fixtures the same way the live adapter
  // would parse a real API response. They verify the complete parsing logic
  // without requiring internet access.

  test('fixture search response has the expected shape', () => {
    const data: any = loadFixture('internet-archive-search.json');
    expect(data.response).toBeDefined();
    expect(Array.isArray(data.response.docs)).toBe(true);
    expect(data.response.docs.length).toBe(7);
  });

  test('fixture metadata response 001 (CC-BY) has the expected fields', () => {
    const data: any = loadFixture('internet-archive-metadata-001.json');
    expect(data.metadata.identifier).toBe('test-cc-by-album-001');
    expect(data.metadata.licenseurl).toContain('/licenses/by/4.0/');
    expect(Array.isArray(data.files)).toBe(true);
    const mp3 = data.files.find((f: any) => f.format === 'VBR MP3');
    expect(mp3).toBeDefined();
    expect(mp3.name).toBe('track01.mp3');
  });

  test('fixture search hits with valid licenses parse to valid AudioMetadata', () => {
    const { parseIaLicense, parseIaDuration, pickBestMp3File, classifyCategory } = iaInternals;
    const search: any = loadFixture('internet-archive-search.json');
    const metadata001: any = loadFixture('internet-archive-metadata-001.json');

    // Simulate the adapter's logic for item 001 (CC-BY)
    const license = parseIaLicense(metadata001.metadata.licenseurl);
    expect(license).not.toBeNull();
    expect(license!.licenseType).toBe('CC-BY 4.0');
    expect(license!.attributionRequired).toBe(true);

    const file = pickBestMp3File(metadata001.files);
    expect(file).not.toBeNull();
    const duration = parseIaDuration(file!.length);
    expect(duration).toBe(204); // 3:24

    const { category, mood } = classifyCategory(
      metadata001.metadata.title,
      metadata001.metadata.description
    );
    // The fixture's description is "Upbeat instrumental track suitable for
    // product promotion and travel videos." → matches "upbeat" → Upbeat.
    expect(category).toBe('Upbeat');

    // Verify the search response includes this item
    const hit = search.response.docs.find((d: any) => d.identifier === 'test-cc-by-album-001');
    expect(hit).toBeDefined();
  });

  test('fixture item 002 (Public Domain) parses with no attribution required', () => {
    const { parseIaLicense, parseIaDuration, pickBestMp3File } = iaInternals;
    const meta: any = loadFixture('internet-archive-metadata-002.json');
    const license = parseIaLicense(meta.metadata.licenseurl);
    expect(license!.licenseType).toBe('Public Domain');
    expect(license!.attributionRequired).toBe(false);

    const file = pickBestMp3File(meta.files);
    expect(file).not.toBeNull();
    // The fixture's length is "204" (numeric seconds)
    expect(parseIaDuration(file!.length)).toBe(204);
  });

  test('fixture item 003 (CC0) parses with CC0 license type', () => {
    const { parseIaLicense, parseIaDuration, pickBestMp3File } = iaInternals;
    const meta: any = loadFixture('internet-archive-metadata-003.json');
    const license = parseIaLicense(meta.metadata.licenseurl);
    expect(license!.licenseType).toBe('CC0');
    expect(license!.attributionRequired).toBe(false);

    const file = pickBestMp3File(meta.files);
    expect(file).not.toBeNull();
    // The fixture's length is "5:00" → 300 seconds
    expect(parseIaDuration(file!.length)).toBe(300);
  });

  test('fixture item 007 (CC-BY cinematic) classifies as Cinematic', () => {
    const { parseIaLicense, classifyCategory } = iaInternals;
    const meta: any = loadFixture('internet-archive-metadata-007.json');
    const license = parseIaLicense(meta.metadata.licenseurl);
    expect(license!.licenseType).toBe('CC-BY 4.0');
    expect(license!.attributionRequired).toBe(true);

    const { category, mood } = classifyCategory(
      meta.metadata.title,
      meta.metadata.description
    );
    // Fixture description: "Epic orchestral trailer music for cinematic content."
    // → matches "cinematic" + "trailer" → Cinematic
    expect(category).toBe('Cinematic');
    expect(mood).toBe('Dramatic');
  });
});

// ============================================================================
// 7. Internet Archive — provider constructed correctly (no live API)
// ============================================================================

describe('V19.1 §4.2 — Internet Archive provider construction', () => {
  test('createInternetArchiveProvider returns a configured provider', () => {
    const p = createInternetArchiveProvider();
    expect(p.name).toBe('external-internet-archive');
    expect(p.configured).toBe(true);
  });

  test('listSfx returns [] (provider serves music, not SFX)', async () => {
    const p = createInternetArchiveProvider();
    const sfx = await p.listSfx();
    expect(sfx).toEqual([]);
  });

  test('getById for non-ia: prefix returns null', async () => {
    const p = createInternetArchiveProvider();
    const r = await p.getById('sfx-whoosh');
    expect(r).toBeNull();
  });

  test('getById for ia: prefix that is not in the cache returns null', async () => {
    // Without live API access, listMusic() returns [] (the fetch fails in
    // the sandbox because there is no internet). The getById lookup then
    // finds no match → returns null. This is the honest behavior.
    //
    // The provider enforces a 10s timeout per fetch; the default bun test
    // timeout is 5s, so this test needs an extended timeout to allow the
    // provider's fetch to fail gracefully and return [].
    const p = createInternetArchiveProvider();
    const r = await p.getById('ia:nonexistent:item.mp3');
    expect(r).toBeNull();
  }, 15000);
});

// ============================================================================
// 8. Jamendo — license parsing
// ============================================================================

describe('V19.1 §4.2 — Jamendo license parsing', () => {
  const { parseJamendoLicense } = jamendoInternals;

  test('CC-BY 4.0 → accepted, attribution required', () => {
    const r = parseJamendoLicense('https://creativecommons.org/licenses/by/4.0/');
    expect(r!.licenseType).toBe('CC-BY 4.0');
    expect(r!.attributionRequired).toBe(true);
  });

  test('CC-BY-SA 4.0 → accepted (share-alike)', () => {
    const r = parseJamendoLicense('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(r!.licenseType).toBe('CC-BY-SA 4.0');
    expect(r!.attributionRequired).toBe(true);
  });

  test('CC0 → accepted, no attribution', () => {
    const r = parseJamendoLicense('http://creativecommons.org/publicdomain/zero/1.0/');
    expect(r!.licenseType).toBe('Public Domain');
    expect(r!.attributionRequired).toBe(false);
  });

  test('CC-BY-NC → REJECTED', () => {
    expect(parseJamendoLicense('https://creativecommons.org/licenses/by-nc/4.0/')).toBeNull();
  });

  test('empty string → REJECTED', () => {
    expect(parseJamendoLicense('')).toBeNull();
  });

  test('undefined → REJECTED', () => {
    expect(parseJamendoLicense(undefined)).toBeNull();
  });
});

// ============================================================================
// 9. Jamendo — track-to-metadata conversion (with fixture)
// ============================================================================

describe('V19.1 §4.2 — Jamendo track-to-metadata conversion', () => {
  const { trackToMetadata } = jamendoInternals;

  test('CC-BY track → valid AudioMetadata with attribution line', () => {
    const fixture: any = loadFixture('jamendo-tracks.json');
    const track = fixture.results[0]; // CC-BY 4.0, "Upbeat Pop Track"
    const meta = trackToMetadata(track);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe('jamendo:1001');
    expect(meta!.title).toBe('Upbeat Pop Track (Fixture)');
    expect(meta!.artist).toBe('Fixture Jamendo Artist One');
    expect(meta!.duration).toBe(184);
    expect(meta!.format).toBe('mp3');
    expect(meta!.licenseType).toBe('CC-BY 4.0');
    expect(meta!.attributionRequired).toBe(true);
    expect(meta!.attributionLine).toContain('Upbeat Pop Track');
    expect(meta!.attributionLine).toContain('Fixture Jamendo Artist One');
    expect(meta!.attributionLine).toContain('CC-BY 4.0');
    expect(meta!.attributionLine).toContain('Jamendo');
    expect(meta!.source).toBe('external-provider:jamendo');
    expect(meta!.available).toBe(true);
    expect(meta!.previewAvailable).toBe(true);
  });

  test('CC-BY-SA track → valid AudioMetadata', () => {
    const fixture: any = loadFixture('jamendo-tracks.json');
    const track = fixture.results[1]; // CC-BY-SA 4.0, "Cinematic Orchestral Piece"
    const meta = trackToMetadata(track);
    expect(meta).not.toBeNull();
    expect(meta!.licenseType).toBe('CC-BY-SA 4.0');
    // The track has "cinematic" + "orchestral" + "epic" + "film-score" tags → Cinematic
    expect(meta!.category).toBe('Cinematic');
  });

  test('CC0 track → valid AudioMetadata, no attribution line', () => {
    const fixture: any = loadFixture('jamendo-tracks.json');
    const track = fixture.results[2]; // CC0, "Public Domain Ambient"
    const meta = trackToMetadata(track);
    expect(meta).not.toBeNull();
    expect(meta!.licenseType).toBe('Public Domain');
    expect(meta!.attributionRequired).toBe(false);
    expect(meta!.attributionLine).toBe('');
    // The track has "ambient" + "atmospheric" + "drone" + "relax" tags → Ambient
    expect(meta!.category).toBe('Ambient');
  });

  test('CC-BY-NC track → REJECTED (returns null)', () => {
    const fixture: any = loadFixture('jamendo-tracks.json');
    const track = fixture.results[3]; // CC-BY-NC 4.0
    const meta = trackToMetadata(track);
    expect(meta).toBeNull();
  });

  test('no-license track → REJECTED (returns null)', () => {
    const fixture: any = loadFixture('jamendo-tracks.json');
    const track = fixture.results[4]; // empty license_ccurl
    const meta = trackToMetadata(track);
    expect(meta).toBeNull();
  });
});

// ============================================================================
// 10. Jamendo — provider construction (no live API)
// ============================================================================

describe('V19.1 §4.2 — Jamendo provider construction', () => {
  const prevClientId = process.env.JAMENDO_CLIENT_ID;
  afterEach(() => {
    if (prevClientId !== undefined) process.env.JAMENDO_CLIENT_ID = prevClientId;
    else delete process.env.JAMENDO_CLIENT_ID;
  });

  test('without JAMENDO_CLIENT_ID → not configured, returns empty list', async () => {
    delete process.env.JAMENDO_CLIENT_ID;
    const p = createJamendoProvider();
    expect(p.configured).toBe(false);
    const music = await p.listMusic();
    expect(music).toEqual([]);
  });

  test('with JAMENDO_CLIENT_ID → configured; listMusic returns [] without live API', async () => {
    process.env.JAMENDO_CLIENT_ID = 'test-fixture-id';
    const p = createJamendoProvider();
    expect(p.configured).toBe(true);
    // Without internet egress, the fetch fails + the adapter returns [].
    const music = await p.listMusic();
    expect(music).toEqual([]);
  });

  test('listSfx returns [] (Jamendo serves music, not SFX)', async () => {
    process.env.JAMENDO_CLIENT_ID = 'test-fixture-id';
    const p = createJamendoProvider();
    expect(await p.listSfx()).toEqual([]);
  });

  test('getById for non-jamendo: prefix returns null', async () => {
    process.env.JAMENDO_CLIENT_ID = 'test-fixture-id';
    const p = createJamendoProvider();
    expect(await p.getById('sfx-whoosh')).toBeNull();
  });
});
