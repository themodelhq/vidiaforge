// VidiaForge v19.1 — Professional Trim Tools Tests
//
// V19.1 §26: Automated tests for every trim operation with exact boundary
// assertions. Test matrix: A=0-5, B=5-10, C=10-15.
//
// V19.1 §53: Deterministic — same input always produces same output.

import { test, expect, describe, beforeEach } from 'bun:test';
import {
  rippleTrim,
  rollEdit,
  slipEdit,
  slideEdit,
  liftClip,
  extractClip,
  insertClip,
  overwriteClip,
  extendClip,
  type TrimContext,
} from '../../src/lib/timeline/trim-operations';
import type { TimelineClip, TimelineTrack } from '../../src/lib/types';

function buildABC(): TrimContext {
  // V19.1 §26: A=0-5, B=5-10, C=10-15 on a single video track
  const track: TimelineTrack = {
    id: 'track1', kind: 'video', name: 'Video 1',
    locked: false, hidden: false, solo: false, muted: false, height: 80,
  };

  function buildClip(id: string, start: number, duration: number): TimelineClip {
    return {
      id,
      trackId: 'track1',
      kind: 'video',
      sourceStart: start,
      sourceEnd: start + duration,
      timelineStart: start,
      duration,
      speed: 1,
      reverse: false,
      frozen: null,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      blendMode: 'normal',
      color: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0 },
      audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
      effects: [], filters: [], transitions: [], keyframes: [], masks: [],
      enabled: true,
    };
  }

  return {
    tracks: [track],
    clips: [buildClip('A', 0, 5), buildClip('B', 5, 5), buildClip('C', 10, 5)],
  };
}

function assertClip(clip: TimelineClip, id: string, timelineStart: number, duration: number) {
  expect(clip.id).toBe(id);
  expect(clip.timelineStart).toBe(timelineStart);
  expect(clip.duration).toBe(duration);
}

describe('V19.1 §25: Professional Trim Tools', () => {
  // === Ripple (§25) ===
  test('ripple: shrink A to 3s → B + C shift left by 2', () => {
    const ctx = buildABC();
    const result = rippleTrim(ctx, 'A', 3);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 3);
    assertClip(B, 'B', 3, 5);   // shifted from 5 → 3
    assertClip(C, 'C', 8, 5);   // shifted from 10 → 8
  });

  test('ripple: extend A to 8s → B + C shift right by 3', () => {
    const ctx = buildABC();
    const result = rippleTrim(ctx, 'A', 8);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 8);
    assertClip(B, 'B', 8, 5);   // shifted from 5 → 8
    assertClip(C, 'C', 13, 5);  // shifted from 10 → 13
  });

  test('ripple: refuse duration <= 0', () => {
    const ctx = buildABC();
    const result = rippleTrim(ctx, 'A', 0);
    expect(result.clips).toBe(ctx.clips); // unchanged
    expect(result.description).toContain('refused');
  });

  test('ripple: refuse on locked track', () => {
    const ctx: TrimContext = {
      tracks: [{ id: 'track1', kind: 'video', name: 'Locked', locked: true, hidden: false, solo: false, muted: false, height: 80 }],
      clips: buildABC().clips,
    };
    const result = rippleTrim(ctx, 'A', 3);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('locked');
  });

  // === Roll (§25) ===
  test('roll: +1 between A and B → A gains 1s, B loses 1s', () => {
    const ctx = buildABC();
    const result = rollEdit(ctx, 'A', 'B', 1);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    assertClip(A, 'A', 0, 6);
    assertClip(B, 'B', 6, 4);
    // C is unchanged
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(C, 'C', 10, 5);
  });

  test('roll: -1 between A and B → A loses 1s, B gains 1s', () => {
    const ctx = buildABC();
    const result = rollEdit(ctx, 'A', 'B', -1);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    assertClip(A, 'A', 0, 4);
    assertClip(B, 'B', 4, 6);
  });

  test('roll: refuse non-adjacent clips', () => {
    const ctx = buildABC();
    const result = rollEdit(ctx, 'A', 'C', 1);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('adjacent');
  });

  test('roll: refuse if delta would make A negative', () => {
    const ctx = buildABC();
    const result = rollEdit(ctx, 'A', 'B', -10);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('negative');
  });

  // === Slip (§25) ===
  test('slip: +2 on B → source shifts +2, timeline unchanged', () => {
    const ctx = buildABC();
    const result = slipEdit(ctx, 'B', 2, 100);
    const B = result.clips.find((c) => c.id === 'B')!;
    expect(B.sourceStart).toBe(7);  // was 5 → 7
    expect(B.sourceEnd).toBe(12);   // was 10 → 12
    expect(B.timelineStart).toBe(5);
    expect(B.duration).toBe(5);
  });

  test('slip: refuse if sourceStart would go negative', () => {
    const ctx = buildABC();
    const result = slipEdit(ctx, 'B', -10);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('sourceStart');
  });

  test('slip: refuse if sourceEnd would exceed assetDuration', () => {
    const ctx = buildABC();
    const result = slipEdit(ctx, 'B', 100, 15);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('sourceEnd');
  });

  // === Slide (§25) ===
  test('slide: +2 on B → A extends, B moves right, C shifts right', () => {
    const ctx = buildABC();
    const result = slideEdit(ctx, 'B', 2);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 7);  // extended from 5 → 7
    assertClip(B, 'B', 7, 5);  // moved from 5 → 7
    assertClip(C, 'C', 12, 5); // shifted from 10 → 12
  });

  test('slide: -2 on B → A shrinks, B moves left, C shifts left', () => {
    const ctx = buildABC();
    const result = slideEdit(ctx, 'B', -2);
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 3);
    assertClip(B, 'B', 3, 5);
    assertClip(C, 'C', 8, 5);
  });

  test('slide: refuse if delta would make prev clip negative', () => {
    const ctx = buildABC();
    const result = slideEdit(ctx, 'B', -10);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('negative');
  });

  // === Lift (§25) ===
  test('lift: remove B, gap left in place', () => {
    const ctx = buildABC();
    const result = liftClip(ctx, 'B');
    expect(result.clips.length).toBe(2);
    const A = result.clips.find((c) => c.id === 'A')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 5);
    assertClip(C, 'C', 10, 5); // unchanged — gap remains
  });

  // === Extract (§25) ===
  test('extract: remove B, C shifts left to close gap', () => {
    const ctx = buildABC();
    const result = extractClip(ctx, 'B');
    expect(result.clips.length).toBe(2);
    const A = result.clips.find((c) => c.id === 'A')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 5);
    assertClip(C, 'C', 5, 5); // shifted from 10 → 5
  });

  // === Insert (§25) ===
  test('insert: new clip X at position 3, duration 4 → downstream shifted right', () => {
    const ctx = buildABC();
    const newClip: TimelineClip = {
      id: 'X',
      trackId: 'track1',
      kind: 'video',
      sourceStart: 0, sourceEnd: 4,
      timelineStart: 0, duration: 4,
      speed: 1, reverse: false, frozen: null,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      blendMode: 'normal',
      color: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0 },
      audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
      effects: [], filters: [], transitions: [], keyframes: [], masks: [],
      enabled: true,
    };
    const result = insertClip(ctx, newClip, 3);
    const X = result.clips.find((c) => c.id === 'X')!;
    const A = result.clips.find((c) => c.id === 'A')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(A, 'A', 0, 5);  // upstream — unchanged
    assertClip(X, 'X', 3, 4);  // inserted at 3
    assertClip(B, 'B', 9, 5);  // shifted from 5 → 9
    assertClip(C, 'C', 14, 5); // shifted from 10 → 14
  });

  // === Overwrite (§25) ===
  test('overwrite: new clip X at position 3, duration 4 → A trimmed, B trimmed', () => {
    const ctx = buildABC();
    const newClip: TimelineClip = {
      id: 'X',
      trackId: 'track1',
      kind: 'video',
      sourceStart: 0, sourceEnd: 4,
      timelineStart: 0, duration: 4,
      speed: 1, reverse: false, frozen: null,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      blendMode: 'normal',
      color: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0 },
      audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
      effects: [], filters: [], transitions: [], keyframes: [], masks: [],
      enabled: true,
    };
    const result = overwriteClip(ctx, newClip, 3);
    const A = result.clips.find((c) => c.id === 'A')!;
    const X = result.clips.find((c) => c.id === 'X')!;
    const B = result.clips.find((c) => c.id === 'B')!;
    // A trimmed to end at 3
    assertClip(A, 'A', 0, 3);
    // X inserted at 3, duration 4
    assertClip(X, 'X', 3, 4);
    // B trimmed to start at 7
    assertClip(B, 'B', 7, 3);
  });

  test('overwrite: clip entirely inside overwrite region → removed', () => {
    const ctx = buildABC();
    // Overwrite region 4-11 covers B (5-10) entirely → B removed.
    // A (0-5) gets trimmed to 0-4. C (10-15) gets trimmed to start at 11.
    const newClip: TimelineClip = {
      id: 'X',
      trackId: 'track1',
      kind: 'video',
      sourceStart: 0, sourceEnd: 7,
      timelineStart: 0, duration: 7,
      speed: 1, reverse: false, frozen: null,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      blendMode: 'normal',
      color: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0 },
      audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
      effects: [], filters: [], transitions: [], keyframes: [], masks: [],
      enabled: true,
    };
    const result = overwriteClip(ctx, newClip, 4);
    // B (5-10) is entirely inside overwrite region 4-11 → removed
    expect(result.clips.find((c) => c.id === 'B')).toBeUndefined();
    // A (0-5) gets trimmed to end at 4
    const A = result.clips.find((c) => c.id === 'A')!;
    assertClip(A, 'A', 0, 4);
    // C (10-15) gets trimmed to start at 11
    const C = result.clips.find((c) => c.id === 'C')!;
    assertClip(C, 'C', 11, 4); // 15-11=4
    // X is inserted
    expect(result.clips.find((c) => c.id === 'X')).toBeDefined();
  });

  // === Extend (§25) ===
  test('extend: B from 5s to 8s (asset allows)', () => {
    const ctx = buildABC();
    const result = extendClip(ctx, 'B', 8, 100);
    const B = result.clips.find((c) => c.id === 'B')!;
    assertClip(B, 'B', 5, 8);
    expect(B.sourceEnd).toBe(13);
  });

  test('extend: refuse if newDuration <= current', () => {
    const ctx = buildABC();
    const result = extendClip(ctx, 'B', 3);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('<=');
  });

  test('extend: refuse if sourceEnd would exceed assetDuration', () => {
    const ctx = buildABC();
    const result = extendClip(ctx, 'B', 100, 15);
    expect(result.clips).toBe(ctx.clips);
    expect(result.description).toContain('sourceEnd');
  });

  // V19.1 §53: determinism
  test('determinism: same input → same output (50 runs)', () => {
    const ctx = buildABC();
    const first = rippleTrim(ctx, 'A', 3);
    for (let i = 0; i < 50; i++) {
      const r = rippleTrim(ctx, 'A', 3);
      expect(r.clips).toEqual(first.clips);
      expect(r.description).toBe(first.description);
    }
  });
});
