// VidiaForge v19.1 — Professional Trim Tools
//
// V19.1 §25: Real ripple/roll/slip/slide/lift/extract/insert/overwrite/extend.
// These are pure functions that take the current clips array + an operation
// spec and return the new clips array. They're tested by tests/trim-operations.test.ts
// (V19.1 §26 — automated tests with exact boundary assertions).
//
// All operations preserve clip IDs (no mutation) — they return new arrays.
// Operations respect:
//   - track locking (locked tracks are never modified)
//   - clip.enable (disabled clips still occupy space but don't render)
//   - sourceStart/sourceEnd (must remain within asset bounds — caller's job)
//
// V19.1 §26: Test matrix
//   A = 0-5
//   B = 5-10
//   C = 10-15
// Each operation produces deterministic, asserted output.

import type { TimelineClip, TimelineTrack } from '../types';

export interface TrimContext {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

export interface TrimResult {
  clips: TimelineClip[];
  /** Human-readable description of what changed (for UI feedback). */
  description: string;
}

// === Ripple (§25) ===
// Changing clip duration automatically shifts downstream clips on the same
// track to close the gap created by the duration change.
//
// Example:
//   Before: A=0-5, B=5-10, C=10-15
//   Ripple A to duration=3
//   After: A=0-3, B=3-8, C=8-13  (B + C shifted left by 2)
//
// If ripple EXTENDS the clip, downstream clips shift right (creating space).
export function rippleTrim(
  ctx: TrimContext,
  clipId: string,
  newDuration: number,
): TrimResult {
  if (newDuration <= 0) {
    return { clips: ctx.clips, description: 'Ripple refused: new duration must be > 0' };
  }
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: `Ripple refused: clip ${clipId} not found` };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Ripple refused: track ${track.name} is locked` };
  }

  const delta = newDuration - clip.duration;
  // Update the rippled clip's duration + sourceEnd
  const updatedClip: TimelineClip = {
    ...clip,
    duration: newDuration,
    sourceEnd: clip.sourceStart + newDuration * clip.speed,
  };

  // Shift downstream clips on the same track by `delta`
  const newClips = ctx.clips.map((c) => {
    if (c.id === clipId) return updatedClip;
    if (c.trackId !== clip.trackId) return c;
    if (c.timelineStart < clip.timelineStart) return c; // upstream — unchanged
    // Downstream — shift by delta
    return { ...c, timelineStart: c.timelineStart + delta };
  });

  return {
    clips: newClips,
    description: `Rippled clip ${clipId} to ${newDuration}s; ${delta > 0 ? '+' : ''}${delta.toFixed(2)}s shift on downstream clips`,
  };
}

// === Roll (§25) ===
// Adjust the edit point between two adjacent clips. The end of clip A moves
// forward/backward by `delta`, and the start of clip B moves the same amount.
// Total duration of the pair is unchanged.
//
// Example:
//   Before: A=0-5, B=5-10
//   Roll +1 (extend A into B)
//   After: A=0-6, B=6-11  (A gains 1s, B loses 1s from its start)
//
// Constraints:
//   - delta can't make A's duration < 0 or > B's start
//   - delta can't make B's duration < 0
//   - sourceStart/sourceEnd must be clamped to the asset bounds (caller's job)
export function rollEdit(
  ctx: TrimContext,
  clipAId: string,
  clipBId: string,
  delta: number,
): TrimResult {
  const clipA = ctx.clips.find((c) => c.id === clipAId);
  const clipB = ctx.clips.find((c) => c.id === clipBId);
  if (!clipA || !clipB) {
    return { clips: ctx.clips, description: 'Roll refused: clip not found' };
  }
  if (clipA.trackId !== clipB.trackId) {
    return { clips: ctx.clips, description: 'Roll refused: clips must be on the same track' };
  }
  const track = ctx.tracks.find((t) => t.id === clipA.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Roll refused: track ${track.name} is locked` };
  }

  // Validate: A must end where B starts
  const aEnd = clipA.timelineStart + clipA.duration;
  if (Math.abs(aEnd - clipB.timelineStart) > 0.001) {
    return { clips: ctx.clips, description: 'Roll refused: clips must be adjacent' };
  }

  // Validate: delta can't make either clip negative
  if (clipA.duration + delta <= 0) {
    return { clips: ctx.clips, description: `Roll refused: delta ${delta} would make clip A negative` };
  }
  if (clipB.duration - delta <= 0) {
    return { clips: ctx.clips, description: `Roll refused: delta ${delta} would make clip B negative` };
  }

  const newClips = ctx.clips.map((c) => {
    if (c.id === clipAId) {
      return {
        ...c,
        duration: c.duration + delta,
        sourceEnd: c.sourceStart + (c.duration + delta) * c.speed,
      };
    }
    if (c.id === clipBId) {
      return {
        ...c,
        timelineStart: c.timelineStart + delta,
        duration: c.duration - delta,
        sourceStart: c.sourceStart + delta * c.speed,
      };
    }
    return c;
  });

  return {
    clips: newClips,
    description: `Rolled ${delta}s from ${clipBId} into ${clipAId}`,
  };
}

// === Slip (§25) ===
// Change the source in/out points while preserving the timeline position + duration.
// Effectively shifts which part of the source media is shown.
//
// Example:
//   Before: clip shows source 10-15 (duration 5, timeline 0-5)
//   Slip +2
//   After: clip shows source 12-17 (duration still 5, timeline still 0-5)
//
// Constraint: sourceStart can't go negative, and sourceEnd can't exceed asset.duration.
export function slipEdit(
  ctx: TrimContext,
  clipId: string,
  delta: number,
  assetDuration?: number,
): TrimResult {
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: 'Slip refused: clip not found' };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Slip refused: track ${track.name} is locked` };
  }

  const newSourceStart = clip.sourceStart + delta;
  const newSourceEnd = clip.sourceEnd + delta;

  // Validate
  if (newSourceStart < 0) {
    return { clips: ctx.clips, description: `Slip refused: sourceStart would be ${newSourceStart} (< 0)` };
  }
  if (assetDuration !== undefined && newSourceEnd > assetDuration) {
    return { clips: ctx.clips, description: `Slip refused: sourceEnd would be ${newSourceEnd} > ${assetDuration}` };
  }

  const newClips = ctx.clips.map((c) =>
    c.id === clipId
      ? { ...c, sourceStart: newSourceStart, sourceEnd: newSourceEnd }
      : c,
  );

  return {
    clips: newClips,
    description: `Slipped clip ${clipId} by ${delta}s (source media shifted)`,
  };
}

// === Slide (§25) ===
// Move a clip left/right while adjusting neighboring clips' durations to
// maintain continuity. The slide clip's duration + source in/out are unchanged.
//
// Example:
//   Before: A=0-5, B=5-10, C=10-15
//   Slide B +2
//   After: A=0-7 (extended), B=7-12 (moved +2), C=12-17 (moved +2, same duration)
//
// Constraints:
//   - A must be able to extend (source has more media OR A is just a gap filler)
//   - If B slides left, A's duration decreases, C moves left
export function slideEdit(
  ctx: TrimContext,
  clipId: string,
  delta: number,
): TrimResult {
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: 'Slide refused: clip not found' };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Slide refused: track ${track.name} is locked` };
  }

  // Find the previous + next clips on the same track
  const sameTrackClips = ctx.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => a.timelineStart - b.timelineStart);
  const idx = sameTrackClips.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    return { clips: ctx.clips, description: 'Slide refused: clip not on its track' };
  }
  const prev = idx > 0 ? sameTrackClips[idx - 1] : null;
  const next = idx < sameTrackClips.length - 1 ? sameTrackClips[idx + 1] : null;

  // Validate
  if (delta > 0 && prev) {
    // Sliding right extends prev's duration
    // No constraint violation unless prev has fixed sourceEnd (caller's job)
  }
  if (delta < 0 && prev) {
    // Sliding left shrinks prev's duration
    if (prev.duration + delta <= 0) {
      return { clips: ctx.clips, description: `Slide refused: delta ${delta} would make prev clip negative` };
    }
  }

  const newClips = ctx.clips.map((c) => {
    if (c.id === clipId) {
      // Slide clip moves by delta — duration + source unchanged
      return { ...c, timelineStart: c.timelineStart + delta };
    }
    if (prev && c.id === prev.id) {
      // Prev clip's duration changes (extends if sliding right, shrinks if left)
      return {
        ...c,
        duration: c.duration + delta,
        sourceEnd: c.sourceStart + (c.duration + delta) * c.speed,
      };
    }
    if (next && c.id === next.id) {
      // Next clip's timelineStart shifts by delta (its duration + source unchanged)
      return { ...c, timelineStart: c.timelineStart + delta };
    }
    return c;
  });

  return {
    clips: newClips,
    description: `Slid clip ${clipId} by ${delta}s`,
  };
}

// === Lift (§25) ===
// Remove a clip + leave a gap. Other clips on the track stay in place.
//
// Example:
//   Before: A=0-5, B=5-10, C=10-15
//   Lift B
//   After: A=0-5, [gap 5-10], C=10-15
export function liftClip(
  ctx: TrimContext,
  clipId: string,
): TrimResult {
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: 'Lift refused: clip not found' };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Lift refused: track ${track.name} is locked` };
  }
  // Remove the clip — gap remains because other clips keep their timelineStart
  const newClips = ctx.clips.filter((c) => c.id !== clipId);
  return {
    clips: newClips,
    description: `Lifted clip ${clipId} (gap left in place)`,
  };
}

// === Extract (§25) ===
// Remove a clip + close the gap. Downstream clips on the same track shift left.
//
// Example:
//   Before: A=0-5, B=5-10, C=10-15
//   Extract B
//   After: A=0-5, C=5-10  (C shifted left by 5)
export function extractClip(
  ctx: TrimContext,
  clipId: string,
): TrimResult {
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: 'Extract refused: clip not found' };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Extract refused: track ${track.name} is locked` };
  }
  const removedDuration = clip.duration;
  const removedEnd = clip.timelineStart + removedDuration;

  // Remove the clip + shift downstream clips left
  const newClips = ctx.clips
    .filter((c) => c.id !== clipId)
    .map((c) => {
      if (c.trackId !== clip.trackId) return c;
      if (c.timelineStart < removedEnd) return c; // upstream or overlapping — unchanged
      // Downstream — shift left by removedDuration
      return { ...c, timelineStart: c.timelineStart - removedDuration };
    });

  return {
    clips: newClips,
    description: `Extracted clip ${clipId} (gap closed, downstream shifted left by ${removedDuration}s)`,
  };
}

// === Insert (§25) ===
// Insert a clip at a given timeline position, shifting downstream clips right.
//
// Example:
//   Before: A=0-5, B=5-10
//   Insert new clip X at position 3, duration 4
//   After: A=0-3 (unchanged), X=3-7 (new), B=9-14 (shifted right by 4)
//
// Note: if the insert position is mid-clip, that clip is split (caller's job
// OR use splitClipAt first).
export function insertClip(
  ctx: TrimContext,
  newClip: TimelineClip,
  position: number,
): TrimResult {
  const track = ctx.tracks.find((t) => t.id === newClip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Insert refused: track ${track.name} is locked` };
  }

  // Shift downstream clips right by newClip.duration
  const shiftedClips = ctx.clips.map((c) => {
    if (c.trackId !== newClip.trackId) return c;
    if (c.timelineStart < position) return c; // upstream — unchanged
    // Downstream — shift right
    return { ...c, timelineStart: c.timelineStart + newClip.duration };
  });

  // Insert the new clip at position
  const insertedClip: TimelineClip = {
    ...newClip,
    timelineStart: position,
  };

  return {
    clips: [...shiftedClips, insertedClip],
    description: `Inserted clip ${newClip.id} at ${position}s (downstream shifted right by ${newClip.duration}s)`,
  };
}

// === Overwrite (§25) ===
// Place a clip at a given timeline position. Downstream clips are NOT shifted
// (the new clip overwrites whatever was there). Existing clips that overlap
// the overwrite region are trimmed or removed.
//
// Example:
//   Before: A=0-5, B=5-10
//   Overwrite new clip X at position 3, duration 4
//   After: A=0-3 (trimmed to fit), X=3-7 (new), B=7-10 (trimmed to fit)
export function overwriteClip(
  ctx: TrimContext,
  newClip: TimelineClip,
  position: number,
): TrimResult {
  const track = ctx.tracks.find((t) => t.id === newClip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Overwrite refused: track ${track.name} is locked` };
  }

  const overwriteStart = position;
  const overwriteEnd = position + newClip.duration;

  const updatedClips: TimelineClip[] = [];
  for (const c of ctx.clips) {
    if (c.trackId !== newClip.trackId) {
      updatedClips.push(c);
      continue;
    }
    const cEnd = c.timelineStart + c.duration;
    // Case 1: clip is entirely before the overwrite region — keep
    if (cEnd <= overwriteStart) {
      updatedClips.push(c);
      continue;
    }
    // Case 2: clip is entirely after the overwrite region — keep
    if (c.timelineStart >= overwriteEnd) {
      updatedClips.push(c);
      continue;
    }
    // Case 3: clip overlaps the overwrite region — trim or split
    if (c.timelineStart < overwriteStart && cEnd > overwriteEnd) {
      // Split into two parts: before + after
      const beforeDuration = overwriteStart - c.timelineStart;
      const afterStart = overwriteEnd;
      const afterDuration = cEnd - overwriteEnd;
      updatedClips.push({
        ...c,
        duration: beforeDuration,
        sourceEnd: c.sourceStart + beforeDuration * c.speed,
      });
      updatedClips.push({
        ...c,
        id: `${c.id}_after`,
        timelineStart: afterStart,
        duration: afterDuration,
        sourceStart: c.sourceStart + (afterStart - c.timelineStart) * c.speed,
        sourceEnd: c.sourceStart + (afterStart - c.timelineStart + afterDuration) * c.speed,
      });
      continue;
    }
    if (c.timelineStart < overwriteStart) {
      // Trim the end of this clip to overwriteStart
      const newDuration = overwriteStart - c.timelineStart;
      updatedClips.push({
        ...c,
        duration: newDuration,
        sourceEnd: c.sourceStart + newDuration * c.speed,
      });
      continue;
    }
    if (cEnd > overwriteEnd) {
      // Trim the start of this clip to overwriteEnd
      const newDuration = cEnd - overwriteEnd;
      const sourceDelta = (overwriteEnd - c.timelineStart) * c.speed;
      updatedClips.push({
        ...c,
        timelineStart: overwriteEnd,
        duration: newDuration,
        sourceStart: c.sourceStart + sourceDelta,
      });
      continue;
    }
    // Clip is entirely inside the overwrite region — remove it
    // (don't push)
  }

  const insertedClip: TimelineClip = {
    ...newClip,
    timelineStart: position,
  };
  updatedClips.push(insertedClip);

  return {
    clips: updatedClips,
    description: `Overwrote region ${overwriteStart}-${overwriteEnd}s with clip ${newClip.id}`,
  };
}

// === Extend (§25) ===
// Extend a clip's duration to reach the playhead position, where source media
// permits. The clip's sourceEnd extends to fill the new duration.
//
// Example:
//   Before: clip duration 5, source 0-5, playhead at 8
//   Extend to playhead
//   After: clip duration 8, source 0-8
//
// Constraints:
//   - newDuration must be > current duration
//   - sourceEnd can't exceed assetDuration
//   - if next clip would be overlapped, the caller should handle (extract first)
export function extendClip(
  ctx: TrimContext,
  clipId: string,
  newDuration: number,
  assetDuration?: number,
): TrimResult {
  const clip = ctx.clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips: ctx.clips, description: 'Extend refused: clip not found' };
  }
  const track = ctx.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    return { clips: ctx.clips, description: `Extend refused: track ${track.name} is locked` };
  }
  if (newDuration <= clip.duration) {
    return { clips: ctx.clips, description: `Extend refused: new duration ${newDuration} <= current ${clip.duration}` };
  }
  const newSourceEnd = clip.sourceStart + newDuration * clip.speed;
  if (assetDuration !== undefined && newSourceEnd > assetDuration) {
    return { clips: ctx.clips, description: `Extend refused: sourceEnd would be ${newSourceEnd} > ${assetDuration}` };
  }

  const newClips = ctx.clips.map((c) =>
    c.id === clipId
      ? { ...c, duration: newDuration, sourceEnd: newSourceEnd }
      : c,
  );

  return {
    clips: newClips,
    description: `Extended clip ${clipId} from ${clip.duration}s to ${newDuration}s`,
  };
}
