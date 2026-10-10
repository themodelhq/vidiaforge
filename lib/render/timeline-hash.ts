// VidiaForge — Render timeline content hash
//
// Closes the P0-27/P0-28 deduplication hole: previously the render dedup
// check used only (projectId, format, resolution, fps, bitrate) — it didn't
// include the timeline CONTENT. A user who edited their timeline and re-
// submitted a render was told "an identical render is already in progress"
// (the dedup short-circuit returned the OLD job for the OLD timeline).
//
// `computeTimelineHash` extracts the render-relevant fields from a timeline
// JSON string, serializes them canonically (sorted keys at every level), and
// returns the SHA-256 hex digest. Two timelines with byte-identical render
// output produce the same hash; a timeline edit produces a different hash.
//
// EXCLUDED (irrelevant UI state — does NOT affect render output):
//   - selectedClipIds, selectedTrackIds, hoveredClipId, etc.
//   - scrollX, scrollY, zoom, playhead
//   - panel states (which panel is open, modal open, etc.)
//   - thumbnailUrl + waveformUrl on clips (these are derived from the source
//     asset, not from the timeline itself — the asset's storagePath is the
//     stable identifier; a thumbnail regeneration shouldn't invalidate a
//     cached render).
//   - label, color, groupId, linkedClipIds (UI annotations only — the
//     underlying asset + transforms determine the render output)
//
// INCLUDED (render-relevant):
//   - tracks: id, kind, name, locked, hidden, solo, muted, height
//     (NOT the `color` UI hint)
//   - clips: id, trackId, kind, assetId, assetName, sourceStart, sourceEnd,
//     timelineStart, duration, speed, reverse, frozen, transform, crop,
//     blendMode, color, audio, effects, filters, transitions, keyframes,
//     masks, text, caption, enabled
//     (NOT label, color, thumbnailUrl, waveformUrl, linkedClipIds, groupId)
//   - markers: id, time, label, color, note
//   - inPoint, outPoint (render region)
//
// The hash is computed over the canonical JSON form (key-sorted recursively)
// so it's stable across implementations that store objects with different key
// insertion orders. `JSON.stringify` with a custom replacer achieves this in
// one pass.
//
// Algorithm:
//   1. Parse the timeline JSON (returns the empty-string hash on parse failure
//      — caller should never persist a hash for a malformed timeline).
//   2. Pick the render-relevant subset of fields.
//   3. Canonicalize: recursively sort object keys, deduplicate arrays of
//      primitives (no — keep arrays in source order; we don't want a
//      shuffled timeline to hash the same).
//   4. SHA-256 over the UTF-8 bytes of the canonical JSON.
//   5. Return hex digest.

import { createHash } from 'crypto';

/**
 * SHA-256 hash of the render-relevant timeline content.
 *
 * @param timelineData The `timelineData` JSON string stored on the Project
 *   row (e.g. `project.timelineData`). Empty string / null / malformed JSON
 *   produces a stable hash of the canonical empty form so two malformed
 *   timelines hash identically (caller decides whether to dedup them).
 * @returns 64-character lowercase hex SHA-256 digest. NEVER throws.
 */
export function computeTimelineHash(timelineData: string): string {
  // 1. Parse
  let raw: any = {};
  if (typeof timelineData === 'string' && timelineData.length > 0) {
    try {
      raw = JSON.parse(timelineData);
      if (raw === null || typeof raw !== 'object') raw = {};
    } catch {
      raw = {};
    }
  } else if (timelineData && typeof timelineData === 'object') {
    // Defensive — allow callers to pass an already-parsed object.
    raw = timelineData;
  }

  // 2. Extract render-relevant subset
  const canonical = extractRenderRelevant(raw);

  // 3. Canonical serialize (sorted keys recursively)
  const json = canonicalStringify(canonical);

  // 4. SHA-256
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

// ─── Extraction ──────────────────────────────────────────────────────────────

interface CanonicalClip {
  id: string;
  trackId: string;
  kind: string;
  assetId?: string;
  assetName?: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  duration: number;
  speed: number;
  reverse: boolean;
  frozen?: { at: number; duration: number } | null;
  transform: unknown;
  crop: unknown;
  blendMode: string;
  color: unknown;
  audio: unknown;
  effects: unknown[];
  filters: unknown[];
  transitions: unknown[];
  keyframes: unknown[];
  masks: unknown[];
  text?: unknown;
  caption?: unknown;
  enabled: boolean;
}

interface CanonicalTrack {
  id: string;
  kind: string;
  name: string;
  locked: boolean;
  hidden: boolean;
  solo: boolean;
  muted: boolean;
  height: number;
}

interface CanonicalMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  note?: string;
}

interface CanonicalTimeline {
  tracks: CanonicalTrack[];
  clips: CanonicalClip[];
  markers: CanonicalMarker[];
  inPoint?: number;
  outPoint?: number;
}

function extractRenderRelevant(raw: any): CanonicalTimeline {
  const tracks: CanonicalTrack[] = (Array.isArray(raw?.tracks) ? raw.tracks : [])
    .filter((t: any) => t && typeof t === 'object')
    .map((t: any) => ({
      id: String(t.id ?? ''),
      kind: String(t.kind ?? ''),
      name: String(t.name ?? ''),
      locked: !!t.locked,
      hidden: !!t.hidden,
      solo: !!t.solo,
      muted: !!t.muted,
      height: Number(t.height ?? 0),
    }));

  const clips: CanonicalClip[] = (Array.isArray(raw?.clips) ? raw.clips : [])
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any) => ({
      id: String(c.id ?? ''),
      trackId: String(c.trackId ?? ''),
      kind: String(c.kind ?? ''),
      assetId: c.assetId != null ? String(c.assetId) : undefined,
      assetName: c.assetName != null ? String(c.assetName) : undefined,
      sourceStart: Number(c.sourceStart ?? 0),
      sourceEnd: Number(c.sourceEnd ?? 0),
      timelineStart: Number(c.timelineStart ?? 0),
      duration: Number(c.duration ?? 0),
      speed: Number(c.speed ?? 1),
      reverse: !!c.reverse,
      frozen: c.frozen != null
        ? { at: Number(c.frozen.at ?? 0), duration: Number(c.frozen.duration ?? 0) }
        : null,
      transform: c.transform ?? {},
      crop: c.crop ?? {},
      blendMode: String(c.blendMode ?? 'normal'),
      color: c.color ?? {},
      audio: c.audio ?? {},
      effects: Array.isArray(c.effects) ? c.effects : [],
      filters: Array.isArray(c.filters) ? c.filters : [],
      transitions: Array.isArray(c.transitions) ? c.transitions : [],
      keyframes: Array.isArray(c.keyframes) ? c.keyframes : [],
      masks: Array.isArray(c.masks) ? c.masks : [],
      text: c.text,
      caption: c.caption,
      enabled: c.enabled !== false, // default true unless explicitly false
    }));

  const markers: CanonicalMarker[] = (Array.isArray(raw?.markers) ? raw.markers : [])
    .filter((m: any) => m && typeof m === 'object')
    .map((m: any) => ({
      id: String(m.id ?? ''),
      time: Number(m.time ?? 0),
      label: String(m.label ?? ''),
      color: String(m.color ?? ''),
      note: m.note != null ? String(m.note) : undefined,
    }));

  const out: CanonicalTimeline = { tracks, clips, markers };

  // inPoint / outPoint define the render region — include them.
  // (typeof check: must be a finite number — Infinity/NaN coerced to undefined.)
  if (typeof raw?.inPoint === 'number' && Number.isFinite(raw.inPoint)) {
    out.inPoint = raw.inPoint;
  }
  if (typeof raw?.outPoint === 'number' && Number.isFinite(raw.outPoint)) {
    out.outPoint = raw.outPoint;
  }

  return out;
}

// ─── Canonical serialization ──────────────────────────────────────────────────

/**
 * Recursively serialize a value with object keys sorted alphabetically.
 * Arrays preserve their source order (a shuffled timeline MUST hash
 * differently). Undefined values are omitted (matching JSON.stringify).
 */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    // Preserve array order. Recurse into elements.
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // Sort keys at every level.
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue; // match JSON.stringify: omit undefined
      out[k] = canonicalize(v);
    }
    return out;
  }
  // Primitives: numbers, strings, booleans are JSON-stable as-is.
  // Note: BigInt would throw — but our extraction never produces BigInt.
  return value;
}
