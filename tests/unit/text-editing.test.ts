// VidiaForge v19.1 — Text-Based Video Editing Tests
//
// V19.1 §33: Verify that deleting transcript text actually removes the
// corresponding timeline range + shifts downstream clips.

import { test, expect, describe } from 'bun:test';
import {
  buildTranscriptSegments,
  deleteSentence,
  deleteWord,
  deleteSilence,
  deleteFillerWords,
} from '../../src/lib/ai/text-editing';
import type { TimelineClip, CaptionCue } from '../../src/lib/types';

function buildClip(id: string, timelineStart: number, duration: number): TimelineClip {
  return {
    id,
    trackId: 'track1',
    kind: 'video',
    sourceStart: 0,
    sourceEnd: duration,
    timelineStart,
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

function buildCue(start: number, end: number, text: string, words?: Array<{ text: string; start: number; end: number }>): CaptionCue {
  return { id: `cue-${start}`, start, end, text, words };
}

describe('V19.1 §33: Text-Based Video Editing', () => {
  test('buildTranscriptSegments: cues → segments with absolute timeline positions', () => {
    const clip = buildClip('clip1', 10, 20); // clip at 10-30
    const cues = [
      buildCue(0, 2, 'Hello'),
      buildCue(2, 4, 'World'),
    ];
    const segments = buildTranscriptSegments(clip, cues);
    expect(segments.length).toBe(2);
    expect(segments[0].timelineStart).toBe(10); // 10 + 0
    expect(segments[0].timelineEnd).toBe(12);  // 10 + 2
    expect(segments[1].timelineStart).toBe(12);
    expect(segments[1].timelineEnd).toBe(14);
  });

  test('deleteSentence: middle range → clip splits into 2 + downstream shifts', () => {
    const clip = buildClip('A', 0, 10);
    const nextClip = buildClip('B', 10, 5);
    const clips = [clip, nextClip];
    const cues = [
      buildCue(0, 3, 'First sentence'),
      buildCue(3, 6, 'Middle sentence'), // this one gets deleted
      buildCue(6, 10, 'Last sentence'),
    ];
    const segments = buildTranscriptSegments(clip, cues);
    const result = deleteSentence(clips, segments[1]); // delete middle

    // Original clip A (0-10) → split into A_a (0-3) + A_b (was 6-10, shifted left by 3)
    const aA = result.clips.find((c) => c.id === 'A_a');
    const aB = result.clips.find((c) => c.id === 'A_b');
    expect(aA).toBeDefined();
    expect(aB).toBeDefined();
    expect(aA!.timelineStart).toBe(0);
    expect(aA!.duration).toBe(3);
    // A_b was at 6-10 (duration 4), shifted left by 3 → 3-7
    expect(aB!.timelineStart).toBe(3);
    expect(aB!.duration).toBe(4);
    // B was at 10-15, shifted left by 3 → 7-12
    const b = result.clips.find((c) => c.id === 'B');
    expect(b!.timelineStart).toBe(7);
    expect(b!.duration).toBe(5);
    expect(result.removedDuration).toBe(3);
  });

  test('deleteWord: removes a single word from word-level cues', () => {
    const clip = buildClip('A', 0, 10);
    const cues = [
      buildCue(0, 4, 'hello world', [
        { text: 'hello', start: 0, end: 2 },
        { text: 'world', start: 2, end: 4 },
      ]),
    ];
    const segments = buildTranscriptSegments(clip, cues);
    const result = deleteWord([clip], segments[0], 1); // delete "world"

    // Original clip A (0-10) → split into A_a (0-2) + A_b (was 4-10, shifted left by 2)
    const aA = result.clips.find((c) => c.id === 'A_a');
    const aB = result.clips.find((c) => c.id === 'A_b');
    expect(aA).toBeDefined();
    expect(aB).toBeDefined();
    expect(aA!.duration).toBe(2);
    expect(aB!.timelineStart).toBe(2); // 4 - 2 = 2
    expect(aB!.duration).toBe(6); // 10 - 4 = 6
    expect(result.removedDuration).toBe(2);
  });

  test('deleteSilence: removes gaps > 0.3s between cues', () => {
    const clip = buildClip('A', 0, 15);
    const cues = [
      buildCue(0, 3, 'First'),
      // gap 3-6 (3s) — should be removed
      buildCue(6, 9, 'Second'),
      // gap 9-9.5 (0.5s) — should be removed (> 0.3s threshold)
      buildCue(9.5, 12, 'Third'),
      // gap 12-12.2 (0.2s) — should NOT be removed (< 0.3s threshold)
      buildCue(12.2, 15, 'Fourth'),
    ];
    const result = deleteSilence([clip], clip, cues);
    // Total silence removed: 3s (gap 3-6) + 0.5s (gap 9-9.5) = 3.5s
    expect(result.removedDuration).toBeCloseTo(3.5, 2);
    // The original clip is split into fragments (A, A_a, A_b, etc.) after deletions.
    // Sum of all fragment durations should equal original (15) minus removed (3.5) = 11.5
    const fragments = result.clips.filter((c) =>
      c.id === 'A' || c.id.startsWith('A_'),
    );
    const totalDuration = fragments.reduce((sum, c) => sum + c.duration, 0);
    expect(totalDuration).toBeCloseTo(11.5, 2);
  });

  test('deleteFillerWords: removes "um" and "uh" from word-level cues', () => {
    const clip = buildClip('A', 0, 20);
    const cues = [
      buildCue(0, 10, 'um hello uh world', [
        { text: 'um', start: 0, end: 1 },      // filler — delete
        { text: 'hello', start: 1, end: 3 },
        { text: 'uh', start: 3, end: 4 },      // filler — delete
        { text: 'world', start: 4, end: 10 },
      ]),
    ];
    const result = deleteFillerWords([clip], clip, cues);
    // 2 filler words removed: 1s (um) + 1s (uh) = 2s total
    expect(result.removedDuration).toBe(2);
    // The clip should be shorter by 2s
    const clips = result.clips.filter((c) => c.id.startsWith('A'));
    const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
    expect(totalDuration).toBe(18); // 20 - 2 = 18
  });

  test('deleteFillerWords: respects custom filler word list', () => {
    const clip = buildClip('A', 0, 10);
    const cues = [
      buildCue(0, 10, 'hello world like yeah', [
        { text: 'hello', start: 0, end: 2 },
        { text: 'world', start: 2, end: 5 },
        { text: 'like', start: 5, end: 7 },    // filler if in custom list
        { text: 'yeah', start: 7, end: 10 },
      ]),
    ];
    const result = deleteFillerWords([clip], clip, cues, ['like']);
    expect(result.removedDuration).toBe(2); // only "like" removed (2s)
  });

  test('deleteSentence: refuse if clip not found', () => {
    const segments = [{ clipId: 'nonexistent', startInClip: 0, endInClip: 1, timelineStart: 0, timelineEnd: 1, text: 'x' }];
    const result = deleteSentence([buildClip('A', 0, 10)], segments[0] as any);
    expect(result.removedDuration).toBe(0);
    expect(result.description).toContain('not found');
  });

  test('deleteSentence: refuse if range is empty', () => {
    const clip = buildClip('A', 0, 10);
    const cues = [buildCue(0, 5, 'hello')];
    const segments = buildTranscriptSegments(clip, cues);
    // Delete a 0-duration range
    const result = deleteTranscriptRange([clip], clip.id, 3, 3);
    expect(result.removedDuration).toBe(0);
    expect(result.description).toContain('refused');
  });
});

// Import for the inline test
import { deleteTranscriptRange } from '../../src/lib/ai/text-editing';
