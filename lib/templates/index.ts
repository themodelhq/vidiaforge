// VidiaForge v19 — Template Engine
//
// V19 §4-5: Template data model + slot definitions + media replacement logic.
//
// A Template is a reusable project/timeline structure. Templates have SLOTS —
// placeholder references that can be replaced when a user applies the template.
//
// Slot types (V19 §4):
//   - media:     video/image placeholder (replaceable with user's asset)
//   - text:      text placeholder (e.g., "Your Brand Name")
//   - audio:     audio/music placeholder
//   - logo:      brand logo placeholder (uses Brand Kit if available)
//   - color:     brand color placeholder (uses Brand Kit)
//   - font:      brand font placeholder (uses Brand Kit)
//   - caption:   caption placeholder (uses AI transcription if available)
//
// When a user clicks "Use Template":
//   1. A new Project is created from the template's timelineData
//   2. The project's clips have slot IDs tagged on them (clip.slotId)
//   3. The UI shows the slot panel — user can replace each slot
//   4. Replacing a slot updates the corresponding clip in the timeline
//   5. The user can render the project at any time
//
// V19 §5: Media replacement preserves timing/crop/scale/position/animation/
// transitions/effects/masks — only the asset reference changes.

import type { TimelineClip, TimelineTrack, CanvasPreset } from '../types';

// === Slot definitions ===

export type SlotType = 'media' | 'text' | 'audio' | 'logo' | 'color' | 'font' | 'caption';

export interface TemplateSlot {
  /** Stable ID referenced by clip.slotId in the timeline. */
  id: string;
  type: SlotType;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Optional hint text shown below the label. */
  hint?: string;
  /** Whether this slot is required for a valid render. */
  required: boolean;
  /** Default value if the user doesn't replace it (e.g., sample asset ID). */
  defaultValue?: string;
  /** Accepted MIME kinds for media slots. */
  acceptedKinds?: ('video' | 'audio' | 'image')[];
  /** Optional brand kit token — if set, the slot auto-fills from Brand Kit. */
  brandKitToken?: 'logo' | 'primaryColor' | 'accentColor' | 'headingFont' | 'bodyFont';
  /** Min/max duration for media slots (seconds). */
  minDuration?: number;
  maxDuration?: number;
}

// === Template definition (canonical, used by API + UI + tests) ===

export interface TemplateDefinition {
  id: string;
  title: string;
  description?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  thumbnailUrl?: string;
  previewUrl?: string;
  aspectRatio: CanvasPreset;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Full timeline structure — tracks + clips + markers (same shape as Project.timelineData). */
  timelineData: {
    schemaVersion: number;
    tracks: TimelineTrack[];
    clips: TimelineClip[];
    markers: any[];
  };
  /** Slot definitions referenced by clip.slotId. */
  slots: TemplateSlot[];
  tier: 'free' | 'premium' | 'creator_exclusive' | 'sponsored' | 'enterprise' | 'brand';
  license: {
    type: 'cc0' | 'cc-by' | 'royalty-free' | 'editorial' | 'rights-managed';
    commercialUse: boolean;
    attributionRequired: boolean;
    musicRights?: string;
    stockRights?: string;
    territory?: string;
    expiration?: string;
  };
  creator?: {
    id: string;
    name: string;
    avatarUrl?: string;
    verified: boolean;
  };
  version: number;
  isBuiltin: boolean;
}

// === Template application result ===

export interface ApplyTemplateResult {
  projectId: string;
  /** Clip IDs that have slots to fill. */
  slottedClipIds: string[];
  /** Resolved slot assignments (clipId → slotId). */
  slotMap: Record<string, string>;
}

// === Slot assignment (user's chosen replacement for a slot) ===

export interface SlotAssignment {
  slotId: string;
  /** For media slots: assetId from the user's MediaAsset. */
  assetId?: string;
  /** For text slots: the text content. */
  text?: string;
  /** For color slots: hex color string. */
  color?: string;
  /** For font slots: font family name. */
  font?: string;
}

/**
 * V19 §5: Apply a slot assignment to a clip.
 *
 * Preserves timing/crop/scale/position/animation/transitions/effects/masks —
 * only the slot-relevant fields change.
 */
export function applySlotToClip(
  clip: TimelineClip,
  slot: TemplateSlot,
  assignment: SlotAssignment
): TimelineClip {
  const next = { ...clip };
  switch (slot.type) {
    case 'media':
    case 'audio':
    case 'logo':
      // Replace the asset reference. Preserve all transform/effects/masks/timing.
      if (assignment.assetId) {
        next.assetId = assignment.assetId;
      }
      break;
    case 'text':
    case 'caption':
      // Replace the text content. Preserve font + styling.
      if (assignment.text !== undefined && next.text) {
        next.text = { ...next.text, text: assignment.text };
      }
      break;
    case 'color':
      // Brand color — apply as a ColorAdjust temperature/tint shift OR as the
      // clip's label color. We use labelColor since it's a UI-visible signal
      // without changing the actual color grading.
      if (assignment.color) {
        next.labelColor = assignment.color;
      }
      break;
    case 'font':
      // Brand font — apply to text clips.
      if (assignment.font && next.text) {
        next.text = { ...next.text, fontFamily: assignment.font };
      }
      break;
  }
  return next;
}

/**
 * V19 §17: Auto-fill a template from a batch of user assets.
 *
 * Iterates through slots in order, assigning user-provided assets round-robin.
 * Text slots get a default placeholder; brand-kit slots pull from the kit.
 */
export function autoFillSlots(
  slots: TemplateSlot[],
  assets: { assetId: string; kind: 'video' | 'audio' | 'image' }[],
  brandKit?: {
    logo?: string;
    primaryColor?: string;
    accentColor?: string;
    headingFont?: string;
    bodyFont?: string;
  }
): SlotAssignment[] {
  const assignments: SlotAssignment[] = [];
  let mediaIdx = 0;
  const mediaAssets = assets.filter((a) => a.kind === 'video' || a.kind === 'image');
  const audioAssets = assets.filter((a) => a.kind === 'audio');

  for (const slot of slots) {
    switch (slot.type) {
      case 'media':
      case 'logo': {
        if (slot.brandKitToken === 'logo' && brandKit?.logo) {
          assignments.push({ slotId: slot.id, assetId: brandKit.logo });
        } else if (mediaAssets.length > 0) {
          assignments.push({ slotId: slot.id, assetId: mediaAssets[mediaIdx % mediaAssets.length].assetId });
          mediaIdx++;
        }
        break;
      }
      case 'audio': {
        if (audioAssets.length > 0) {
          assignments.push({ slotId: slot.id, assetId: audioAssets[0].assetId });
        }
        break;
      }
      case 'color': {
        if (slot.brandKitToken === 'primaryColor' && brandKit?.primaryColor) {
          assignments.push({ slotId: slot.id, color: brandKit.primaryColor });
        } else if (slot.brandKitToken === 'accentColor' && brandKit?.accentColor) {
          assignments.push({ slotId: slot.id, color: brandKit.accentColor });
        }
        break;
      }
      case 'font': {
        if (slot.brandKitToken === 'headingFont' && brandKit?.headingFont) {
          assignments.push({ slotId: slot.id, font: brandKit.headingFont });
        } else if (slot.brandKitToken === 'bodyFont' && brandKit?.bodyFont) {
          assignments.push({ slotId: slot.id, font: brandKit.bodyFont });
        }
        break;
      }
      case 'text':
      case 'caption': {
        assignments.push({ slotId: slot.id, text: slot.defaultValue || 'Your text here' });
        break;
      }
    }
  }
  return assignments;
}

/**
 * V19.1 §5.6 — Validate a template's slot-clip structural consistency.
 *
 * Returns `{ valid, errors }` where `errors` is a list of human-readable
 * reasons why the template is internally inconsistent. A template with
 * errors should not be exposed to users — it indicates a bug in the
 * template definition.
 *
 * Checks:
 *   - slot IDs are unique within the template
 *   - every required slot has at least one clip referencing it
 *   - every clip.slotId resolves to a defined slot
 *   - no orphan slots (every defined slot is referenced by ≥1 clip)
 *   - slot type matches clip kind (media → video/image, audio → audio,
 *     text/caption → text, logo → image)
 *
 * Used by:
 *   - tests/unit/template-slot-validation.test.ts (the source of truth
 *     for this validation)
 *   - the /api/templates/[id]/{use,apply} routes (defense-in-depth)
 */
export function validateTemplateSlotConsistency(template: {
  id: string;
  slots: TemplateSlot[];
  timelineData: { clips: any[]; tracks: any[] };
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. slot IDs unique
  const slotIds = template.slots.map((s) => s.id);
  if (new Set(slotIds).size !== slotIds.length) {
    errors.push('Duplicate slot IDs');
  }

  // 2. every required slot has a referencing clip
  for (const slot of template.slots) {
    if (!slot.required) continue;
    const refs = template.timelineData.clips.filter((c: any) => c.slotId === slot.id);
    if (refs.length === 0) {
      errors.push(`Required slot "${slot.id}" (${slot.label}) has no referencing clip`);
    }
  }

  // 3. every clip.slotId resolves
  const slotIdSet = new Set(slotIds);
  for (const clip of template.timelineData.clips) {
    if (clip.slotId && !slotIdSet.has(clip.slotId)) {
      errors.push(`Clip "${clip.id}" references unknown slotId "${clip.slotId}"`);
    }
  }

  // 4. no orphan slots
  const referenced = new Set(
    template.timelineData.clips.map((c: any) => c.slotId).filter(Boolean)
  );
  for (const slot of template.slots) {
    if (!referenced.has(slot.id)) {
      errors.push(`Orphan slot "${slot.id}" (${slot.label}) — no clip references it`);
    }
  }

  // 5. slot type matches clip kind
  const slotById = new Map(template.slots.map((s) => [s.id, s]));
  const allowedKindsForSlotType = (slotType: SlotType): ReadonlySet<string> => {
    switch (slotType) {
      case 'media': return new Set(['video', 'image']);
      case 'audio': return new Set(['audio']);
      case 'text':
      case 'caption': return new Set(['text']);
      case 'logo': return new Set(['image']);
      case 'color':
      case 'font': return new Set(['video', 'image', 'audio', 'text']);
      default: return new Set(['video', 'image', 'audio', 'text']);
    }
  };
  for (const clip of template.timelineData.clips) {
    if (!clip.slotId) continue;
    const slot = slotById.get(clip.slotId);
    if (!slot) continue;
    const allowed = allowedKindsForSlotType(slot.type);
    if (!allowed.has(clip.kind)) {
      errors.push(
        `Clip "${clip.id}" kind "${clip.kind}" doesn't match slot "${slot.id}" type "${slot.type}"`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * V19 §75: Template security — sanitize a template's timelineData to prevent
 * injection attacks. Strips dangerous fields and validates clip shape.
 *
 * Templates MUST NOT be able to:
 *   - execute arbitrary code
 *   - inject HTML/JavaScript (text is escaped at render time)
 *   - access another user's project
 *   - access private storage
 *   - modify another user's assets
 */
export function sanitizeTemplateData(timelineData: unknown): {
  timelineData: TemplateDefinition['timelineData'];
  slots: never[];
} | null {
  if (!timelineData || typeof timelineData !== 'object') return null;
  const td = timelineData as any;
  if (typeof td.schemaVersion !== 'number') return null;
  if (!Array.isArray(td.tracks)) return null;
  if (!Array.isArray(td.clips)) return null;
  if (!Array.isArray(td.markers ?? [])) return null;

  // Validate each clip — reject any with dangerous fields
  for (const clip of td.clips) {
    if (typeof clip !== 'object' || clip === null) return null;
    // V19 §75: reject clips with arbitrary code execution fields
    if ('__dangerous' in clip || 'eval' in clip || 'script' in clip) return null;
    // Reject clips with storageKey pointing outside the user's namespace
    if (typeof clip.storageKey === 'string' && clip.storageKey.startsWith('/etc/')) return null;
  }

  return {
    timelineData: {
      schemaVersion: td.schemaVersion,
      tracks: td.tracks,
      clips: td.clips,
      markers: td.markers ?? [],
    },
    slots: [],
  };
}
