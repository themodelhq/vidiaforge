// VidiaForge V19.1 §5.6 — Template media-slot validation unit tests
//
// V19.1 PHASE 3 — COMPLETE THE TEMPLATE EXPERIENCE.
//
// These tests verify the template slot model is internally consistent:
//
//   1. Every required slot has at least one clip that references it
//      (otherwise the user can't satisfy a required slot, and the
//      template would be unrenderable).
//   2. Slot types match clip kinds:
//      - `media` slots → `video` or `image` clips
//      - `audio` slots → `audio` clips
//      - `text` slots  → `text` clips
//      - `logo` slots  → `image` clips
//      A mismatch is a structural bug in the template definition.
//   3. No orphan slots — every defined slot is referenced by at least
//      one clip. An orphan slot is dead config that confuses users
//      ("why is this slot listed if no clip uses it?").
//   4. The slot's `acceptedKinds` (when present) is consistent with
//      the slot's type.
//   5. Required slots have a `label` (the UI shows the label; an empty
//      label on a required slot is a UX bug).
//
// These tests run without a database — they only exercise the builtin
// template data, which is pure TypeScript.

import { test, expect, describe } from 'bun:test';
import { BUILTIN_TEMPLATES } from '../../src/lib/templates/builtin-templates';
import { validateTemplateSlotConsistency } from '../../src/lib/templates';
import type { TemplateSlot, SlotType } from '../../src/lib/templates';

/**
 * V19.1 §5.6 — map a slot's `type` to the set of clip `kind` values that
 * are structurally valid for that slot. A clip referencing a slot must
 * have a kind in this set. (Mirrors the logic in
 * `validateTemplateSlotConsistency` — kept here so the test is
 * self-documenting.)
 */
function allowedClipKindsForSlotType(slotType: SlotType): ReadonlySet<string> {
  switch (slotType) {
    case 'media':
      return new Set(['video', 'image']);
    case 'audio':
      return new Set(['audio']);
    case 'text':
    case 'caption':
      return new Set(['text']);
    case 'logo':
      return new Set(['image']);
    case 'color':
    case 'font':
      return new Set(['video', 'image', 'audio', 'text']);
    default:
      return new Set(['video', 'image', 'audio', 'text']);
  }
}

describe('V19.1 §5.6 — Template slot-clip structural consistency', () => {
  test('every required slot has at least one clip that references it', () => {
    // V19.1 §5.6 — a required slot with no corresponding clip is a
    // structural bug: the user can't satisfy a required slot that no
    // clip points at.
    for (const t of BUILTIN_TEMPLATES) {
      const slotIds = new Set(t.slots.map((s) => s.id));
      for (const slot of t.slots) {
        if (!slot.required) continue;
        const referencingClips = t.timelineData.clips.filter(
          (c: any) => c.slotId === slot.id
        );
        expect(
          referencingClips.length,
          `Template "${t.id}": required slot "${slot.id}" (${slot.label}) has no clip referencing it`
        ).toBeGreaterThan(0);
        // sanity: the slot ID is in the slots set
        expect(slotIds.has(slot.id)).toBe(true);
      }
    }
  });

  test('every clip.slotId resolves to a defined slot', () => {
    // V19.1 §5.6 — a clip that references a slotId not in the template's
    // slots array is an orphan clip; the slot panel can't show it.
    for (const t of BUILTIN_TEMPLATES) {
      const slotIds = new Set(t.slots.map((s) => s.id));
      for (const clip of t.timelineData.clips) {
        if (clip.slotId) {
          expect(
            slotIds.has(clip.slotId),
            `Template "${t.id}": clip "${clip.id}" references unknown slotId "${clip.slotId}"`
          ).toBe(true);
        }
      }
    }
  });

  test('no orphan slots — every defined slot is referenced by at least one clip', () => {
    // V19.1 §5.6 — an orphan slot (a slot in the slots array that no clip
    // references) is dead config that confuses users. We don't ship any.
    for (const t of BUILTIN_TEMPLATES) {
      const referencedSlotIds = new Set(
        t.timelineData.clips.map((c: any) => c.slotId).filter(Boolean)
      );
      for (const slot of t.slots) {
        expect(
          referencedSlotIds.has(slot.id),
          `Template "${t.id}": slot "${slot.id}" (${slot.label}) is an orphan — no clip references it`
        ).toBe(true);
      }
    }
  });

  test('slot types match clip kinds', () => {
    // V19.1 §5.6 — a `media` slot must be referenced by a `video` or
    // `image` clip; an `audio` slot by an `audio` clip; a `text` slot
    // by a `text` clip; a `logo` slot by an `image` clip.
    for (const t of BUILTIN_TEMPLATES) {
      const slotById = new Map(t.slots.map((s) => [s.id, s]));
      for (const clip of t.timelineData.clips) {
        if (!clip.slotId) continue;
        const slot = slotById.get(clip.slotId);
        if (!slot) continue;
        const allowed = allowedClipKindsForSlotType(slot.type);
        expect(
          allowed.has(clip.kind),
          `Template "${t.id}": clip "${clip.id}" has kind "${clip.kind}" but references slot "${slot.id}" of type "${slot.type}" (allowed: ${[...allowed].join(', ')})`
        ).toBe(true);
      }
    }
  });

  test('media slots declare acceptedKinds', () => {
    // V19.1 §5.6 — a `media` slot should declare which kinds it accepts
    // (video, image, or both) so the UI can filter the media picker.
    for (const t of BUILTIN_TEMPLATES) {
      for (const slot of t.slots) {
        if (slot.type !== 'media') continue;
        expect(
          Array.isArray(slot.acceptedKinds) && slot.acceptedKinds.length > 0,
          `Template "${t.id}": media slot "${slot.id}" (${slot.label}) must declare acceptedKinds`
        ).toBe(true);
        for (const k of slot.acceptedKinds!) {
          expect(['video', 'image', 'audio']).toContain(k);
        }
      }
    }
  });

  test('audio slots declare acceptedKinds = ["audio"]', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const slot of t.slots) {
        if (slot.type !== 'audio') continue;
        expect(slot.acceptedKinds).toBeDefined();
        expect(slot.acceptedKinds).toContain('audio');
      }
    }
  });

  test('every slot has a non-empty label', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const slot of t.slots) {
        expect(
          typeof slot.label === 'string' && slot.label.trim().length > 0,
          `Template "${t.id}": slot "${slot.id}" has an empty label`
        ).toBe(true);
      }
    }
  });

  test('text slots declare a defaultValue', () => {
    // V19.1 §5.6 — text slots should have a defaultValue so the UI can
    // pre-fill the text input + the template renders something sensible
    // even before the user customizes it.
    for (const t of BUILTIN_TEMPLATES) {
      for (const slot of t.slots) {
        if (slot.type !== 'text' && slot.type !== 'caption') continue;
        expect(
          typeof slot.defaultValue === 'string' && slot.defaultValue.length > 0,
          `Template "${t.id}": text slot "${slot.id}" (${slot.label}) has no defaultValue`
        ).toBe(true);
      }
    }
  });
});

describe('V19.1 §5.6 — Template slot ID uniqueness (per template)', () => {
  test('slot IDs are unique within each template', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const ids = t.slots.map((s) => s.id);
      const unique = new Set(ids);
      expect(unique.size, `Template "${t.id}" has duplicate slot IDs`).toBe(ids.length);
    }
  });

  test('clip IDs are unique within each template', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const ids = t.timelineData.clips.map((c: any) => c.id);
      const unique = new Set(ids);
      expect(unique.size, `Template "${t.id}" has duplicate clip IDs`).toBe(ids.length);
    }
  });

  test('track IDs are unique within each template', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const ids = t.timelineData.tracks.map((tr: any) => tr.id);
      const unique = new Set(ids);
      expect(unique.size, `Template "${t.id}" has duplicate track IDs`).toBe(ids.length);
    }
  });

  test('every clip references an existing track', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const trackIds = new Set(t.timelineData.tracks.map((tr: any) => tr.id));
      for (const clip of t.timelineData.clips) {
        expect(
          trackIds.has(clip.trackId),
          `Template "${t.id}": clip "${clip.id}" references unknown trackId "${clip.trackId}"`
        ).toBe(true);
      }
    }
  });
});

describe('V19.1 §5.6 — Template slot count sanity', () => {
  test('every template has at least 1 slot + at least 1 clip', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.slots.length, `Template "${t.id}" has no slots`).toBeGreaterThan(0);
      expect(t.timelineData.clips.length, `Template "${t.id}" has no clips`).toBeGreaterThan(0);
    }
  });

  test('every template has at least 1 required slot', () => {
    // A template with no required slots is useless — the user can render
    // it without providing any media, which means it's just a static
    // title card (not a template).
    for (const t of BUILTIN_TEMPLATES) {
      const requiredCount = t.slots.filter((s) => s.required).length;
      expect(
        requiredCount,
        `Template "${t.id}" has no required slots`
      ).toBeGreaterThan(0);
    }
  });

  test('catalog covers the 6 main categories (Social, Creator, Events, Business, Visual Styles, Lifestyle)', () => {
    const categories = new Set(BUILTIN_TEMPLATES.map((t) => t.category));
    const expected = ['Social', 'Creator', 'Events', 'Business', 'Visual Styles', 'Lifestyle'];
    for (const c of expected) {
      expect(categories.has(c), `Catalog missing category "${c}"`).toBe(true);
    }
  });
});

/**
 * V19.1 §5.6 — validateTemplateSlotConsistency is now exported from
 * `src/lib/templates/index.ts` (the production module). The tests below
 * exercise the production helper against synthetic bad-template fixtures
 * to verify it detects each kind of structural inconsistency.
 */
describe('V19.1 §5.6 — validateTemplateSlotConsistency (exported helper)', () => {
  test('returns valid=true for every builtin template', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const result = validateTemplateSlotConsistency(t);
      expect(
        result.valid,
        `Template "${t.id}" failed validation: ${result.errors.join('; ')}`
      ).toBe(true);
    }
  });

  test('detects an orphan slot', () => {
    const fake = {
      id: 'test-bad-orphan',
      slots: [
        { id: 'slot-a', type: 'media' as const, label: 'A', required: true, acceptedKinds: ['video' as const] },
        { id: 'slot-b', type: 'media' as const, label: 'B', required: false, acceptedKinds: ['video' as const] },
      ],
      timelineData: {
        clips: [{ id: 'c1', trackId: 't1', kind: 'video', slotId: 'slot-a' }],
        tracks: [{ id: 't1' }],
      },
    };
    const result = validateTemplateSlotConsistency(fake as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Orphan slot "slot-b"'))).toBe(true);
  });

  test('detects a clip referencing an unknown slotId', () => {
    const fake = {
      id: 'test-bad-unknown-slot',
      slots: [
        { id: 'slot-a', type: 'media' as const, label: 'A', required: true, acceptedKinds: ['video' as const] },
      ],
      timelineData: {
        clips: [
          { id: 'c1', trackId: 't1', kind: 'video', slotId: 'slot-a' },
          { id: 'c2', trackId: 't1', kind: 'video', slotId: 'slot-ghost' },
        ],
        tracks: [{ id: 't1' }],
      },
    };
    const result = validateTemplateSlotConsistency(fake as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown slotId "slot-ghost"'))).toBe(true);
  });

  test('detects a slot type / clip kind mismatch', () => {
    const fake = {
      id: 'test-bad-kind-mismatch',
      slots: [
        { id: 'slot-audio', type: 'audio' as const, label: 'Music', required: true, acceptedKinds: ['audio' as const] },
      ],
      timelineData: {
        clips: [
          // An `audio` slot referenced by a `video` clip is a mismatch.
          { id: 'c1', trackId: 't1', kind: 'video', slotId: 'slot-audio' },
        ],
        tracks: [{ id: 't1' }],
      },
    };
    const result = validateTemplateSlotConsistency(fake as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("doesn't match slot"))).toBe(true);
  });

  test('detects a required slot with no referencing clip', () => {
    const fake = {
      id: 'test-bad-required-no-clip',
      slots: [
        { id: 'slot-a', type: 'media' as const, label: 'A', required: true, acceptedKinds: ['video' as const] },
        { id: 'slot-b', type: 'media' as const, label: 'B', required: false, acceptedKinds: ['video' as const] },
      ],
      timelineData: {
        clips: [{ id: 'c1', trackId: 't1', kind: 'video', slotId: 'slot-b' }],
        tracks: [{ id: 't1' }],
      },
    };
    const result = validateTemplateSlotConsistency(fake as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Required slot "slot-a"'))).toBe(true);
  });
});
