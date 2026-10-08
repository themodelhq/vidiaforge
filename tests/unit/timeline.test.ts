// VidiaForge — Unit tests for timeline pure functions
//
// Tests src/lib/timeline.ts — the building blocks for timeline state:
//   - createClip (with sensible defaults)
//   - computeDuration (max clip end)
//   - formatTimecode (HH:MM:SS:FF + seconds)
//   - snap (nearest target within threshold)
//
// The split/trim/move operations are tested by composing createClip
// with adjusted sourceStart/sourceEnd/duration/timelineStart —
// the way the real editor (src/stores/editor-store.ts) does it.
//
// Run: bun run test:unit

import { test, expect, describe } from 'bun:test';
import {
  createClip,
  createTrack,
  emptyTimelineState,
  emptyProjectDocument,
  computeDuration,
  formatTimecode,
  formatDuration,
  formatBytes,
  snap,
  defaultTransform,
  defaultColor,
  defaultAudio,
  CANVAS_DIMENSIONS,
  RESOLUTION_MULTIPLIER,
  resolutionFor,
} from '../../src/lib/timeline';
import type { TimelineClip } from '../../src/lib/types';

describe('createClip', () => {
  test('produces correct defaults when only trackId + kind are passed', () => {
    const clip = createClip({ trackId: 'trk1', kind: 'video' });

    // Required fields
    expect(clip.id).toBeTruthy();
    expect(typeof clip.id).toBe('string');
    expect(clip.trackId).toBe('trk1');
    expect(clip.kind).toBe('video');

    // Default source range (0 → duration)
    expect(clip.sourceStart).toBe(0);
    expect(clip.sourceEnd).toBe(5);
    expect(clip.timelineStart).toBe(0);
    expect(clip.duration).toBe(5);

    // Default playback
    expect(clip.speed).toBe(1);
    expect(clip.reverse).toBe(false);
    expect(clip.frozen).toBeNull();
    expect(clip.enabled).toBe(true);

    // Default nested objects
    expect(clip.transform).toEqual(defaultTransform());
    expect(clip.color).toEqual(defaultColor());
    expect(clip.audio).toEqual(defaultAudio());
    expect(clip.blendMode).toBe('normal');

    // Empty arrays
    expect(clip.effects).toEqual([]);
    expect(clip.filters).toEqual([]);
    expect(clip.transitions).toEqual([]);
    expect(clip.keyframes).toEqual([]);
    expect(clip.masks).toEqual([]);
  });

  test('respects explicit duration when provided', () => {
    const clip = createClip({ trackId: 'trk1', kind: 'video', duration: 10 });
    expect(clip.duration).toBe(10);
    expect(clip.sourceEnd).toBe(10);
  });

  test('respects explicit sourceStart / sourceEnd / timelineStart', () => {
    const clip = createClip({
      trackId: 'trk1',
      kind: 'audio',
      sourceStart: 5,
      sourceEnd: 12,
      timelineStart: 20,
      duration: 7,
    });
    expect(clip.sourceStart).toBe(5);
    expect(clip.sourceEnd).toBe(12);
    expect(clip.timelineStart).toBe(20);
    expect(clip.duration).toBe(7);
  });

  test('respects explicit kind (audio, image, text, ...)', () => {
    for (const kind of ['video', 'audio', 'image', 'text', 'subtitle'] as const) {
      const clip = createClip({ trackId: 'trk1', kind });
      expect(clip.kind).toBe(kind);
    }
  });

  test('respects explicit assetId', () => {
    const clip = createClip({
      trackId: 'trk1',
      kind: 'video',
      assetId: 'asset_abc',
      assetName: 'sample.mp4',
    });
    expect(clip.assetId).toBe('asset_abc');
    expect(clip.assetName).toBe('sample.mp4');
  });
});

describe('splitClip via createClip composition', () => {
  // splitClip doesn't exist as a standalone function in src/lib/timeline.ts.
  // Instead, the editor composes the split using createClip with adjusted
  // sourceStart/sourceEnd/duration. This test verifies that composition
  // produces the expected two-clip split.

  test('splitting a 5s clip at t=2s produces a 2s clip + a 3s clip', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      sourceStart: 0,
      sourceEnd: 5,
      timelineStart: 0,
      duration: 5,
    });

    const splitAt = 2;
    // Strip the id so createClip generates a fresh one (createClip spreads
    // params AFTER setting id: uid('clip'), so an explicit `id: undefined`
    // would override the generated id with undefined).
    const { id: _originalId, ...rest } = original;

    // First half: source 0-2s, timeline 0-2s
    const firstHalf = createClip({
      ...rest,
      sourceStart: original.sourceStart,
      sourceEnd: original.sourceStart + splitAt,
      timelineStart: original.timelineStart,
      duration: splitAt,
    });

    // Second half: source 2-5s, timeline 2-5s
    const secondHalf = createClip({
      ...rest,
      sourceStart: original.sourceStart + splitAt,
      sourceEnd: original.sourceEnd,
      timelineStart: original.timelineStart + splitAt,
      duration: original.duration - splitAt,
    });

    // First half covers source 0-2s, plays at timeline 0-2s
    expect(firstHalf.sourceStart).toBe(0);
    expect(firstHalf.sourceEnd).toBe(2);
    expect(firstHalf.timelineStart).toBe(0);
    expect(firstHalf.duration).toBe(2);

    // Second half covers source 2-5s, plays at timeline 2-5s
    expect(secondHalf.sourceStart).toBe(2);
    expect(secondHalf.sourceEnd).toBe(5);
    expect(secondHalf.timelineStart).toBe(2);
    expect(secondHalf.duration).toBe(3);

    // Total duration preserved
    expect(firstHalf.duration + secondHalf.duration).toBe(original.duration);

    // Each clip got a unique id (different from the original + from each other)
    expect(firstHalf.id).toBeTruthy();
    expect(secondHalf.id).toBeTruthy();
    expect(firstHalf.id).not.toBe(secondHalf.id);
    expect(firstHalf.id).not.toBe(original.id);
    expect(secondHalf.id).not.toBe(original.id);
  });

  test('splitting a clip with sourceStart=10 at t=3s keeps sourceStart aligned', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      sourceStart: 10,
      sourceEnd: 20,
      timelineStart: 100,
      duration: 10,
    });

    const splitAt = 3;
    const { id: _ignored, ...rest } = original;

    const firstHalf = createClip({
      ...rest,
      sourceEnd: original.sourceStart + splitAt,
      duration: splitAt,
    });
    const secondHalf = createClip({
      ...rest,
      sourceStart: original.sourceStart + splitAt,
      timelineStart: original.timelineStart + splitAt,
      duration: original.duration - splitAt,
    });

    expect(firstHalf.sourceStart).toBe(10);
    expect(firstHalf.sourceEnd).toBe(13);
    expect(firstHalf.timelineStart).toBe(100);
    expect(firstHalf.duration).toBe(3);

    expect(secondHalf.sourceStart).toBe(13);
    expect(secondHalf.sourceEnd).toBe(20);
    expect(secondHalf.timelineStart).toBe(103);
    expect(secondHalf.duration).toBe(7);
  });
});

describe('trimClip via createClip composition', () => {
  // Like splitClip, trimClip is composed by creating a new clip with
  // adjusted sourceStart/sourceEnd/duration. Verify the composition.

  test('trimming a 5s clip to start at t=1s + end at t=4s produces a 3s clip', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      sourceStart: 0,
      sourceEnd: 5,
      timelineStart: 0,
      duration: 5,
    });

    const trimStart = 1;
    const trimEnd = 4;
    const { id: _ignored, ...rest } = original;

    const trimmed = createClip({
      ...rest,
      sourceStart: original.sourceStart + trimStart,
      sourceEnd: original.sourceStart + trimEnd,
      timelineStart: original.timelineStart,
      duration: trimEnd - trimStart,
    });

    expect(trimmed.sourceStart).toBe(1);
    expect(trimmed.sourceEnd).toBe(4);
    expect(trimmed.duration).toBe(3);
  });

  test('trimming the start of a clip with sourceStart=10 to t=2s shifts sourceStart to 12', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'audio',
      sourceStart: 10,
      sourceEnd: 30,
      timelineStart: 0,
      duration: 20,
    });

    const trimFromStart = 2;
    const { id: _ignored, ...rest } = original;

    const trimmed = createClip({
      ...rest,
      sourceStart: original.sourceStart + trimFromStart,
      duration: original.duration - trimFromStart,
    });

    expect(trimmed.sourceStart).toBe(12);
    expect(trimmed.sourceEnd).toBe(30); // unchanged
    expect(trimmed.duration).toBe(18);
  });
});

describe('moveClip via createClip composition', () => {
  // moveClip is composed by creating a new clip with adjusted timelineStart.
  // Verify the clip respects timeline bounds (non-negative timelineStart).

  test('moving a 5s clip to timelineStart=10s places it at [10, 15]', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      duration: 5,
      timelineStart: 0,
    });

    const newStart = 10;
    const { id: _ignored, ...rest } = original;

    const moved = createClip({
      ...rest,
      timelineStart: newStart,
    });

    expect(moved.timelineStart).toBe(10);
    expect(moved.timelineStart + moved.duration).toBe(15);
  });

  test('moving to a negative timelineStart is clamped to 0', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      duration: 5,
      timelineStart: 2,
    });

    // Editor-side bound check: timelineStart must be >= 0
    const requestedStart = -3;
    const clampedStart = Math.max(0, requestedStart);
    const { id: _ignored, ...rest } = original;

    const moved = createClip({
      ...rest,
      timelineStart: clampedStart,
    });

    expect(moved.timelineStart).toBe(0);
    expect(moved.timelineStart + moved.duration).toBe(5);
  });

  test('moving preserves sourceStart / sourceEnd / duration', () => {
    const original = createClip({
      trackId: 'trk1',
      kind: 'video',
      sourceStart: 12,
      sourceEnd: 22,
      timelineStart: 0,
      duration: 10,
    });

    const { id: _ignored, ...rest } = original;

    const moved = createClip({
      ...rest,
      timelineStart: 50,
    });

    expect(moved.sourceStart).toBe(12);
    expect(moved.sourceEnd).toBe(22);
    expect(moved.duration).toBe(10);
    expect(moved.timelineStart).toBe(50);
  });
});

describe('computeDuration', () => {
  test('returns 0 for empty clips array', () => {
    expect(computeDuration([])).toBe(0);
  });

  test('returns the timelineEnd of a single clip', () => {
    const clip = createClip({ trackId: 'trk1', kind: 'video', duration: 5, timelineStart: 0 });
    expect(computeDuration([clip])).toBe(5);
  });

  test('returns max clip end for multiple clips', () => {
    const c1 = createClip({ trackId: 'trk1', kind: 'video', duration: 5, timelineStart: 0 });
    const c2 = createClip({ trackId: 'trk1', kind: 'video', duration: 8, timelineStart: 0 });
    const c3 = createClip({ trackId: 'trk1', kind: 'video', duration: 3, timelineStart: 0 });
    expect(computeDuration([c1, c2, c3])).toBe(8);
  });

  test('returns max (timelineStart + duration) when clips start at non-zero timelineStart', () => {
    const c1 = createClip({ trackId: 'trk1', kind: 'video', duration: 3, timelineStart: 0 });
    const c2 = createClip({ trackId: 'trk1', kind: 'video', duration: 4, timelineStart: 5 });
    // c1 ends at 3, c2 ends at 9
    expect(computeDuration([c1, c2])).toBe(9);
  });
});

describe('formatTimecode', () => {
  test('formats 0 seconds as 00:00:00:00', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
  });

  test('formats 1 second at 30fps as 00:00:01:00', () => {
    expect(formatTimecode(1, 30)).toBe('00:00:01:00');
  });

  test('formats 1.5 seconds at 30fps as 00:00:01:15', () => {
    // 1.5s × 30fps = 45 frames = 1s + 15 frames
    expect(formatTimecode(1.5, 30)).toBe('00:00:01:15');
  });

  test('formats 3661.5 seconds at 30fps as 01:01:01:15', () => {
    // 3661.5s × 30fps = 109845 frames
    // = 1 hour (3600s) + 1 minute (60s) + 1 second + 15 frames
    expect(formatTimecode(3661.5, 30)).toBe('01:01:01:15');
  });

  test('formats negative seconds as 0', () => {
    expect(formatTimecode(-5, 30)).toBe('00:00:00:00');
  });

  test('formats NaN / Infinity as 0', () => {
    expect(formatTimecode(NaN, 30)).toBe('00:00:00:00');
    expect(formatTimecode(Infinity, 30)).toBe('00:00:00:00');
  });

  test('seconds format returns zero-padded seconds with 3 decimals', () => {
    expect(formatTimecode(0, 30, 'seconds')).toBe('000.000');
    expect(formatTimecode(1.5, 30, 'seconds')).toBe('001.500');
    expect(formatTimecode(3661.5, 30, 'seconds')).toBe('3661.500');
  });

  test('respects fps parameter (24fps)', () => {
    // 1s at 24fps = 24 frames = 1 second + 0 frames
    expect(formatTimecode(1, 24)).toBe('00:00:01:00');
    // 1.5s at 24fps = 36 frames = 1s + 12 frames
    expect(formatTimecode(1.5, 24)).toBe('00:00:01:12');
  });
});

describe('formatDuration', () => {
  test('formats 0 seconds as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  test('formats 65 seconds as 1:05', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  test('formats 3661 seconds as 1:01:01', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('formatBytes', () => {
  test('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  test('formats kilobytes', () => {
    expect(formatBytes(1500)).toBe('1.5 KB');
  });

  test('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  test('formats gigabytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});

describe('snap', () => {
  test('snaps to nearest target within threshold', () => {
    const result = snap(5.1, [5, 10], 0.25);
    expect(result.value).toBe(5);
    expect(result.snapped).toBe(true);
  });

  test('does NOT snap when beyond threshold', () => {
    const result = snap(5.5, [5, 10], 0.25);
    expect(result.value).toBe(5.5);
    expect(result.snapped).toBe(false);
  });

  test('snaps to the closest of multiple targets', () => {
    // value=5.9, targets=[5, 6, 10], threshold=0.25
    // 5.9 is 0.9 away from 5 (no snap), 0.1 away from 6 (snap), 4.1 away from 10 (no snap)
    const result = snap(5.9, [5, 6, 10], 0.25);
    expect(result.value).toBe(6);
    expect(result.snapped).toBe(true);
  });

  test('does NOT snap when targets array is empty', () => {
    const result = snap(5, [], 0.25);
    expect(result.value).toBe(5);
    expect(result.snapped).toBe(false);
  });

  test('default threshold is 0.25', () => {
    // 5.2 is 0.2 away from 5 — within default threshold
    const result = snap(5.2, [5]);
    expect(result.snapped).toBe(true);
    expect(result.value).toBe(5);
  });

  test('respects custom threshold', () => {
    // 5.5 with threshold=1.0 — 0.5 away from 5 — within threshold
    const result = snap(5.5, [5], 1.0);
    expect(result.snapped).toBe(true);
    expect(result.value).toBe(5);
  });
});

describe('createTrack', () => {
  test('creates a video track with default name "Video"', () => {
    const track = createTrack('video');
    expect(track.kind).toBe('video');
    expect(track.name).toBe('Video');
    expect(track.locked).toBe(false);
    expect(track.hidden).toBe(false);
    expect(track.solo).toBe(false);
    expect(track.muted).toBe(false);
    expect(track.height).toBe(56);
  });

  test('creates an audio track with height 64', () => {
    const track = createTrack('audio');
    expect(track.kind).toBe('audio');
    expect(track.height).toBe(64);
  });

  test('accepts custom name', () => {
    const track = createTrack('video', 'Background');
    expect(track.name).toBe('Background');
  });

  test('generates unique ids', () => {
    const t1 = createTrack('video');
    const t2 = createTrack('video');
    expect(t1.id).not.toBe(t2.id);
  });
});

describe('emptyTimelineState', () => {
  test('has schemaVersion 1', () => {
    const ts = emptyTimelineState();
    expect(ts.schemaVersion).toBe(1);
  });

  test('creates 3 default tracks (video, audio, text)', () => {
    const ts = emptyTimelineState();
    expect(ts.tracks.length).toBe(3);
    expect(ts.tracks.map((t) => t.kind)).toEqual(['video', 'audio', 'text']);
  });

  test('starts with empty clips + markers', () => {
    const ts = emptyTimelineState();
    expect(ts.clips).toEqual([]);
    expect(ts.markers).toEqual([]);
  });
});

describe('emptyProjectDocument', () => {
  test('has schemaVersion 1', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    expect(doc.schemaVersion).toBe(1);
  });

  test('embeds project metadata', () => {
    const doc = emptyProjectDocument('proj1', 'Test Project');
    expect(doc.project.id).toBe('proj1');
    expect(doc.project.name).toBe('Test Project');
    expect(doc.project.width).toBe(1920);
    expect(doc.project.height).toBe(1080);
    expect(doc.project.fps).toBe(30);
    expect(doc.project.canvasPreset).toBe('16:9');
    expect(doc.project.resolution).toBe('1080p');
  });

  test('has 3 default tracks + empty clips/markers/assets', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    expect(doc.tracks.length).toBe(3);
    expect(doc.clips).toEqual([]);
    expect(doc.markers).toEqual([]);
    expect(doc.assets).toEqual([]);
  });
});

describe('CANVAS_DIMENSIONS + RESOLUTION_MULTIPLIER', () => {
  test('16:9 canvas at 1080p is 1920x1080', () => {
    const base = CANVAS_DIMENSIONS['16:9'];
    expect(base.width).toBe(1920);
    expect(base.height).toBe(1080);
  });

  test('9:16 canvas is 1080x1920 (vertical)', () => {
    const base = CANVAS_DIMENSIONS['9:16'];
    expect(base.width).toBe(1080);
    expect(base.height).toBe(1920);
  });

  test('1:1 canvas is 1080x1080 (square)', () => {
    const base = CANVAS_DIMENSIONS['1:1'];
    expect(base.width).toBe(1080);
    expect(base.height).toBe(1080);
  });

  test('resolutionFor returns same dims as base at 1080p (multiplier=1)', () => {
    const r = resolutionFor('16:9', '1080p');
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  });

  test('resolutionFor returns half dims at 720p (multiplier=0.5)', () => {
    const r = resolutionFor('16:9', '720p');
    expect(r.width).toBe(960);
    expect(r.height).toBe(540);
  });

  test('resolutionFor returns double dims at 4K (multiplier=2)', () => {
    const r = resolutionFor('16:9', '4K');
    expect(r.width).toBe(3840);
    expect(r.height).toBe(2160);
  });

  test('resolutionFor produces even-pixel dims (rounded to nearest 2)', () => {
    // 9:16 at 720p: 1080 * 0.5 = 540, 1920 * 0.5 = 960
    const r = resolutionFor('9:16', '720p');
    expect(r.width % 2).toBe(0);
    expect(r.height % 2).toBe(0);
  });
});

describe('defaultTransform / defaultColor / defaultAudio', () => {
  test('defaultTransform returns centered, full-opacity transform', () => {
    const t = defaultTransform();
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    expect(t.scale).toBe(1);
    expect(t.rotation).toBe(0);
    expect(t.opacity).toBe(1);
    expect(t.anchorX).toBe(0.5);
    expect(t.anchorY).toBe(0.5);
  });

  test('defaultColor returns all-zero color adjustments', () => {
    const c = defaultColor();
    expect(c.exposure).toBe(0);
    expect(c.brightness).toBe(0);
    expect(c.contrast).toBe(0);
    expect(c.saturation).toBe(0);
    expect(c.hue).toBe(0);
  });

  test('defaultAudio returns full-volume, unmuted audio', () => {
    const a = defaultAudio();
    expect(a.volume).toBe(1);
    expect(a.pan).toBe(0);
    expect(a.fadeIn).toBe(0);
    expect(a.fadeOut).toBe(0);
    expect(a.muted).toBe(false);
  });
});

describe('clip type narrowing', () => {
  test('a clip with kind=text can have a text field', () => {
    const clip: TimelineClip = createClip({
      trackId: 'trk1',
      kind: 'text',
      text: {
        text: 'Hello',
        fontFamily: 'Inter',
        fontSize: 48,
        fontWeight: 700,
        italic: false,
        letterSpacing: 0,
        lineHeight: 1.2,
        align: 'center',
        color: '#FFFFFF',
      },
    });
    expect(clip.kind).toBe('text');
    expect(clip.text?.text).toBe('Hello');
  });
});
