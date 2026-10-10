// VidiaForge V19.1 v5 — Built-in SFX honest-labeling tests
//
// V19.1 PHASE 5 — REPAIR THE BUILT-IN SOUND EFFECTS.
//
// These tests verify that the built-in SFX catalog is honestly labeled:
//   - Entries whose titles previously implied field recordings
//     ("Crowd Cheer", "Rain Ambience", "Camera Shutter") are now clearly
//     marked as synthetic ("Synthetic Crowd Bed", "Synthetic Rain Bed",
//     "Synthetic Shutter").
//   - Every entry has a non-empty title + category + mood.
//   - Every entry's source is "builtin-sfx" (not a fabricated external source).
//   - Every entry is CC0 licensed with no attribution required.
//   - The catalog returns exactly 8 SFX (the count is stable).
//   - No SFX title contains the word "Cheer" or "Rain Ambience" or
//     "Camera Shutter" without the "Synthetic" qualifier (regression test
//     for the misleading-label bug).
//
// These tests run without a database or network — they exercise the pure
// TypeScript provider code + read the real SFX files on disk.

import { test, expect, describe } from 'bun:test';
import { createBuiltinSfxProvider } from '../../src/lib/audio';

describe('V19.1 v5 — Built-in SFX honest labeling', () => {
  const provider = createBuiltinSfxProvider();

  test('returns exactly 8 SFX (catalog size is stable)', async () => {
    const sfx = await provider.listSfx();
    expect(sfx.length).toBe(8);
  });

  test('REGRESSION: no SFX title implies a field recording without "Synthetic"', async () => {
    // V19.1 v5 — the bug: the previous titles "Crowd Cheer", "Rain Ambience",
    // and "Camera Shutter" implied real field recordings but were actually
    // synthetic noise bursts. The fix: those three are now prefixed with
    // "Synthetic". This test ensures they don't regress.
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      const title = track.title;
      // "Crowd Cheer" is forbidden — must be "Synthetic Crowd Bed" or similar
      expect(title).not.toBe('Crowd Cheer');
      // "Rain Ambience" is forbidden — must be "Synthetic Rain Bed" or similar
      expect(title).not.toBe('Rain Ambience');
      // "Camera Shutter" is forbidden — must be "Synthetic Shutter" or similar
      expect(title).not.toBe('Camera Shutter');
      // If the title contains "Crowd" / "Rain" / "Shutter" without
      // "Synthetic", it must not also contain words that imply a real
      // recording ("Cheer", "Ambience", "Recording", "Field").
      const lower = title.toLowerCase();
      if (lower.includes('crowd') || lower.includes('rain') || lower.includes('shutter')) {
        if (!lower.includes('synthetic')) {
          expect(lower).not.toMatch(/cheer|ambience|recording|field|real/);
        }
      }
    }
  });

  test('the 3 relabeled entries have "Synthetic" in their title', async () => {
    const sfx = await provider.listSfx();
    const byId = new Map(sfx.map((s) => [s.id, s]));
    // The 3 entries that were previously misleading
    expect(byId.get('sfx-crowd')!.title).toContain('Synthetic');
    expect(byId.get('sfx-rain')!.title).toContain('Synthetic');
    expect(byId.get('sfx-shutter')!.title).toContain('Synthetic');
  });

  test('the 5 generic entries keep their original titles (not over-renamed)', async () => {
    // V19.1 v5 — "Whoosh", "Impact Boom", "Click", "Pop", "Notification"
    // keep their generic titles because a synthetic whoosh / click / pop /
    // notification / impact is still legitimately that thing. Over-renaming
    // them would be churn without honest-labeling benefit.
    const sfx = await provider.listSfx();
    const byId = new Map(sfx.map((s) => [s.id, s]));
    expect(byId.get('sfx-whoosh')!.title).toBe('Whoosh');
    expect(byId.get('sfx-impact')!.title).toBe('Impact Boom');
    expect(byId.get('sfx-click')!.title).toBe('Click');
    expect(byId.get('sfx-pop')!.title).toBe('Pop');
    expect(byId.get('sfx-notification')!.title).toBe('Notification');
  });

  test('every SFX entry has a non-empty title + category + mood', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.category.length).toBeGreaterThan(0);
      expect(track.mood.length).toBeGreaterThan(0);
    }
  });

  test('every SFX entry reports source = "builtin-sfx" (not a fabricated external source)', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.source).toBe('builtin-sfx');
    }
  });

  test('every SFX entry is CC0 licensed with no attribution required', async () => {
    const sfx = await provider.listSfx();
    for (const track of sfx) {
      expect(track.licenseType).toBe('CC0');
      expect(track.attributionRequired).toBe(false);
      expect(track.attributionLine).toBe('');
    }
  });

  test('the 3 relabeled entries have "Synthetic" in their mood', async () => {
    // The mood field for the relabeled entries should also indicate
    // synthetic origin so the UI (which shows category + mood) is honest.
    const sfx = await provider.listSfx();
    const byId = new Map(sfx.map((s) => [s.id, s]));
    expect(byId.get('sfx-crowd')!.mood).toContain('Synthetic');
    expect(byId.get('sfx-rain')!.mood).toContain('Synthetic');
    expect(byId.get('sfx-shutter')!.mood).toContain('Synthetic');
  });

  test('getById returns the relabeled entry for sfx-crowd', async () => {
    const track = await provider.getById('sfx-crowd');
    expect(track).not.toBeNull();
    expect(track!.title).toBe('Synthetic Crowd Bed');
  });

  test('getById returns the relabeled entry for sfx-rain', async () => {
    const track = await provider.getById('sfx-rain');
    expect(track).not.toBeNull();
    expect(track!.title).toBe('Synthetic Rain Bed');
  });

  test('getById returns the relabeled entry for sfx-shutter', async () => {
    const track = await provider.getById('sfx-shutter');
    expect(track).not.toBeNull();
    expect(track!.title).toBe('Synthetic Shutter');
  });
});
