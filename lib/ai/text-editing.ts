// VidiaForge v19.1 — Text-Based Video Editing
//
// V19.1 §33: Use actual transcription output to drive timeline edits.
// User selects text in the transcript editor → deletes it → the corresponding
// timeline media range is removed.
//
// Flow:
//   1. User has an asset with caption cues (from AI transcription)
//   2. User opens the Transcript Editor
//   3. User selects text (word, sentence, or custom range)
//   4. User clicks "Delete"
//   5. This module identifies the timeline range(s) corresponding to the text
//   6. The timeline is trimmed: clips are split + the deleted range is removed
//   7. Downstream clips shift left to close the gap
//
// V19.1 §33: Supports:
//   - delete word(s)
//   - delete sentence
//   - delete silence (gaps between cues)
//   - delete filler words ("um", "uh", "like", "you know")

import type { TimelineClip, CaptionCue } from '../types';
import { extractClip } from '../timeline/trim-operations';

export interface TranscriptSegment {
  /** Clip ID this segment belongs to. */
  clipId: string;
  /** Start time (relative to the clip's timelineStart). */
  startInClip: number;
  /** End time (relative to the clip's timelineStart). */
  endInClip: number;
  /** Absolute timeline start (clip.timelineStart + startInClip). */
  timelineStart: number;
  /** Absolute timeline end (clip.timelineStart + endInClip). */
  timelineEnd: number;
  /** Text content of the segment. */
  text: string;
  /** Word-level segments if available. */
  words?: Array<{
    text: string;
    startInClip: number;
    endInClip: number;
    timelineStart: number;
    timelineEnd: number;
  }>;
  /** Speaker (if known). */
  speaker?: string;
}

export interface TextEditOperation {
  type: 'delete_word' | 'delete_sentence' | 'delete_silence' | 'delete_filler';
  clipId: string;
  startInClip: number;
  endInClip: number;
  text?: string;
  reason?: string;
}

export interface TextEditResult {
  /** Resulting clips after the edit. */
  clips: TimelineClip[];
  /** Description of what was deleted. */
  description: string;
  /** Total duration removed (seconds). */
  removedDuration: number;
}

/**
 * V19.1 §33: Build transcript segments from caption cues.
 *
 * Takes a clip's caption.cues array + the clip's timeline position and returns
 * a flat list of TranscriptSegments with absolute timeline positions.
 */
export function buildTranscriptSegments(
  clip: TimelineClip,
  cues: CaptionCue[],
): TranscriptSegment[] {
  const clipStart = clip.timelineStart;
  return cues.map((cue) => {
    const segment: TranscriptSegment = {
      clipId: clip.id,
      startInClip: cue.start,
      endInClip: cue.end,
      timelineStart: clipStart + cue.start,
      timelineEnd: clipStart + cue.end,
      text: cue.text,
      speaker: cue.speaker,
    };
    if (cue.words && cue.words.length > 0) {
      segment.words = cue.words.map((w) => ({
        text: w.text,
        startInClip: w.start,
        endInClip: w.end,
        timelineStart: clipStart + w.start,
        timelineEnd: clipStart + w.end,
      }));
    }
    return segment;
  });
}

/**
 * V19.1 §33: Delete a sentence from the timeline.
 *
 * Removes the timeline range corresponding to the given transcript segment.
 * The clip is split (if needed) + the deleted range is extracted.
 * Downstream clips shift left to close the gap.
 *
 * Returns the new clips array + metadata about what was removed.
 */
export function deleteTranscriptRange(
  clips: TimelineClip[],
  clipId: string,
  startInClip: number,
  endInClip: number,
  reason?: string,
): TextEditResult {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) {
    return { clips, description: 'Delete refused: clip not found', removedDuration: 0 };
  }

  const removedDuration = endInClip - startInClip;
  if (removedDuration <= 0) {
    return { clips, description: 'Delete refused: range is empty or negative', removedDuration: 0 };
  }

  // V19.1 §33: Three cases:
  //   1. The deleted range is at the start of the clip → trim the clip's start
  //   2. The deleted range is at the end of the clip → trim the clip's end
  //   3. The deleted range is in the middle → split the clip into 2 + remove the middle

  const clipStart = clip.timelineStart;
  const clipEnd = clipStart + clip.duration;
  const delStart = clipStart + startInClip;
  const delEnd = clipStart + endInClip;

  // Case 1: range at start
  if (startInClip <= 0.001) {
    const newDuration = clip.duration - removedDuration;
    const newSourceStart = clip.sourceStart + removedDuration * clip.speed;
    const newClips = clips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            timelineStart: clipStart, // unchanged
            duration: newDuration,
            sourceStart: newSourceStart,
            sourceEnd: newSourceStart + newDuration * clip.speed,
          }
        : c,
    );
    // Now shift downstream clips left by removedDuration
    const shiftedClips = shiftDownstream(newClips, clip.trackId, clipEnd, -removedDuration);
    return {
      clips: shiftedClips,
      description: `Deleted ${removedDuration}s at start of clip ${clipId}${reason ? ` (${reason})` : ''}`,
      removedDuration,
    };
  }

  // Case 2: range at end
  if (endInClip >= clip.duration - 0.001) {
    const newDuration = clip.duration - removedDuration;
    const newClips = clips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            duration: newDuration,
            sourceEnd: clip.sourceStart + newDuration * clip.speed,
          }
        : c,
    );
    const shiftedClips = shiftDownstream(newClips, clip.trackId, clipEnd, -removedDuration);
    return {
      clips: shiftedClips,
      description: `Deleted ${removedDuration}s at end of clip ${clipId}${reason ? ` (${reason})` : ''}`,
      removedDuration,
    };
  }

  // Case 3: range in the middle — split into 2 clips
  // Clip A: timelineStart → delStart, duration = startInClip
  // Clip B: delEnd → clipEnd, duration = clip.duration - endInClip
  const clipA: TimelineClip = {
    ...clip,
    id: `${clip.id}_a`,
    duration: startInClip,
    sourceEnd: clip.sourceStart + startInClip * clip.speed,
  };
  const clipB: TimelineClip = {
    ...clip,
    id: `${clip.id}_b`,
    timelineStart: delEnd,
    duration: clip.duration - endInClip,
    sourceStart: clip.sourceStart + endInClip * clip.speed,
    sourceEnd: clip.sourceStart + endInClip * clip.speed + (clip.duration - endInClip) * clip.speed,
  };

  // Replace the original clip with A + B, then shift B + downstream left
  const newClips: TimelineClip[] = [];
  for (const c of clips) {
    if (c.id === clipId) {
      newClips.push(clipA);
      // B will be added after the shift
    } else {
      newClips.push(c);
    }
  }
  // Shift B + downstream left by removedDuration
  const shiftedClips = newClips.map((c) => {
    if (c.timelineStart >= delEnd && c.trackId === clip.trackId) {
      return { ...c, timelineStart: c.timelineStart - removedDuration };
    }
    return c;
  });
  // Add B (shifted left)
  clipB.timelineStart = delEnd - removedDuration;
  shiftedClips.push(clipB);

  return {
    clips: shiftedClips,
    description: `Deleted ${removedDuration}s in middle of clip ${clipId}${reason ? ` (${reason})` : ''}`,
    removedDuration,
  };
}

/**
 * V19.1 §33: Delete a sentence (entire cue).
 */
export function deleteSentence(
  clips: TimelineClip[],
  segment: TranscriptSegment,
): TextEditResult {
  return deleteTranscriptRange(
    clips,
    segment.clipId,
    segment.startInClip,
    segment.endInClip,
    `sentence: "${segment.text.substring(0, 50)}${segment.text.length > 50 ? '...' : ''}"`,
  );
}

/**
 * V19.1 §33: Delete a single word.
 */
export function deleteWord(
  clips: TimelineClip[],
  segment: TranscriptSegment,
  wordIndex: number,
): TextEditResult {
  if (!segment.words || wordIndex < 0 || wordIndex >= segment.words.length) {
    return { clips, description: 'Delete refused: word index out of range', removedDuration: 0 };
  }
  const word = segment.words[wordIndex];
  return deleteTranscriptRange(
    clips,
    segment.clipId,
    word.startInClip,
    word.endInClip,
    `word: "${word.text}"`,
  );
}

/**
 * V19.1 §33: Delete silence — gaps between cues.
 *
 * Iterates through cues on a clip + finds gaps (silence) between them.
 * Removes each gap by extracting the corresponding timeline range.
 *
 * V19.1 §53: Process from RIGHT to LEFT so earlier deletions don't shift
 * later cue positions. After each deletion, the clip's duration shrinks
 * but the cue positions to the LEFT are unchanged.
 */
export function deleteSilence(
  clips: TimelineClip[],
  clip: TimelineClip,
  cues: CaptionCue[],
): TextEditResult {
  if (cues.length < 2) {
    return { clips, description: 'No silence to remove (need 2+ cues)', removedDuration: 0 };
  }

  // Sort cues by start time
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  let currentClips = clips;
  let totalRemoved = 0;
  const removedRanges: Array<{ start: number; end: number }> = [];

  // Process from right to left so earlier deletions don't shift later cue positions
  for (let i = sorted.length - 2; i >= 0; i--) {
    const cue1End = sorted[i].end;
    const cue2Start = sorted[i + 1].start;
    const gap = cue2Start - cue1End;
    // V19.1 §33: only remove gaps > 0.3s (otherwise it's natural pause)
    if (gap > 0.3) {
      // V19.1 §53: Find the CURRENT clip (it may have been split/modified by
      // previous iterations). We need to find the clip that contains the range
      // [cue1End, cue2Start] in its source.
      // Since we process right-to-left, the clip containing earlier ranges
      // is still intact (only later ranges have been split/shifted).
      // Look for any clip with the same trackId whose source range covers cue1End.
      const trackClips = currentClips.filter((c) => c.trackId === clip.trackId);
      const targetClip = trackClips.find((c) => {
        const clipEndInSource = c.sourceStart + c.duration * c.speed;
        // The range [cue1End, cue2Start] must be within [sourceStart, sourceStart + duration*speed]
        // But after splits, the clip might be a fragment — check if cue1End falls within
        // this fragment's source range.
        return cue1End >= c.sourceStart && cue2Start <= clipEndInSource;
      });

      if (!targetClip) {
        // Can't find a clip containing this range — skip
        continue;
      }

      // V19.1 §53: The cue positions are relative to the ORIGINAL clip's source.
      // After splits, the fragment's sourceStart may have shifted, so we need to
      // adjust the range to be relative to the fragment.
      const adjustedStartInClip = cue1End - targetClip.sourceStart;
      const adjustedEndInClip = cue2Start - targetClip.sourceStart;

      const result = deleteTranscriptRange(
        currentClips,
        targetClip.id,
        adjustedStartInClip,
        adjustedEndInClip,
        `silence: ${gap.toFixed(2)}s gap`,
      );
      currentClips = result.clips;
      totalRemoved += result.removedDuration;
      removedRanges.push({ start: cue1End, end: cue2Start });
    }
  }

  return {
    clips: currentClips,
    description: `Removed ${removedRanges.length} silence gap(s) totaling ${totalRemoved.toFixed(2)}s`,
    removedDuration: totalRemoved,
  };
}

/**
 * V19.1 §33: Delete filler words.
 *
 * Common filler words: "um", "uh", "like", "you know", "basically", "actually".
 * Iterates through word-level segments + deletes any that match.
 *
 * V19.1 §53: Process from RIGHT to LEFT so earlier deletions don't shift
 * later word positions.
 */
export function deleteFillerWords(
  clips: TimelineClip[],
  clip: TimelineClip,
  cues: CaptionCue[],
  customFillerWords?: string[],
): TextEditResult {
  const defaultFillerWords = ['um', 'uh', 'er', 'ah', 'like', 'basically', 'actually', 'literally', 'honestly', 'you know', 'i mean', 'sort of', 'kind of'];
  const fillers = (customFillerWords || defaultFillerWords).map((w) => w.toLowerCase());

  let currentClips = clips;
  let totalRemoved = 0;
  let deletedCount = 0;

  // Collect all words with their absolute source positions
  const allWords: Array<{ word: string; startInSource: number; endInSource: number }> = [];
  for (const cue of cues) {
    if (cue.words) {
      for (const w of cue.words) {
        allWords.push({ word: w.text.toLowerCase().trim(), startInSource: w.start, endInSource: w.end });
      }
    }
  }

  // V19.1 §53: Sort words by position descending + process right-to-left.
  const sortedWords = [...allWords].sort((a, b) => b.startInSource - a.startInSource);
  const fillerWordsToDelete = sortedWords.filter((w) => fillers.includes(w.word));

  for (const w of fillerWordsToDelete) {
    // V19.1 §53: Find the current clip fragment that contains this word's range
    const trackClips = currentClips.filter((c) => c.trackId === clip.trackId);
    const targetClip = trackClips.find((c) => {
      const clipEndInSource = c.sourceStart + c.duration * c.speed;
      return w.startInSource >= c.sourceStart && w.endInSource <= clipEndInSource;
    });

    if (!targetClip) continue;

    // Adjust range to be relative to the fragment
    const adjustedStartInClip = w.startInSource - targetClip.sourceStart;
    const adjustedEndInClip = w.endInSource - targetClip.sourceStart;

    const result = deleteTranscriptRange(
      currentClips,
      targetClip.id,
      adjustedStartInClip,
      adjustedEndInClip,
      `filler word: "${w.word}"`,
    );
    currentClips = result.clips;
    totalRemoved += result.removedDuration;
    deletedCount++;
  }

  return {
    clips: currentClips,
    description: `Removed ${deletedCount} filler word(s) totaling ${totalRemoved.toFixed(2)}s`,
    removedDuration: totalRemoved,
  };
}

// Helper: shift downstream clips on a track by a delta.
function shiftDownstream(
  clips: TimelineClip[],
  trackId: string,
  afterTime: number,
  delta: number,
): TimelineClip[] {
  return clips.map((c) => {
    if (c.trackId !== trackId) return c;
    if (c.timelineStart < afterTime) return c; // upstream — unchanged
    return { ...c, timelineStart: c.timelineStart + delta };
  });
}
