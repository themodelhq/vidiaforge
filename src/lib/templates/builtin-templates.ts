// VidiaForge v19 — Builtin Template Seed Data
//
// V19 §6: Categories cover Trending, Social, Lifestyle, Events, Business,
// Creator, Visual Styles, Music.
//
// Each template is a REAL TemplateDefinition with a valid timelineData that
// can actually be rendered. Templates use placeholder clip IDs that the
// Apply Template flow replaces with the user's media.
//
// V19 §76: Templates reference assets by ID, not by embedding media files.

import type { TemplateDefinition } from './index';
import { uid } from '../timeline';

// Helper: build a minimal valid clip with sensible defaults.
function buildClip(opts: {
  id: string;
  trackId: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  timelineStart: number;
  duration: number;
  slotId?: string;
  text?: string;
}): any {
  return {
    id: opts.id,
    trackId: opts.trackId,
    kind: opts.kind,
    assetId: opts.kind === 'text' ? undefined : `placeholder-${opts.slotId || opts.id}`,
    assetName: opts.kind === 'text' ? undefined : `Placeholder ${opts.slotId || opts.id}`,
    sourceStart: 0,
    sourceEnd: opts.duration,
    timelineStart: opts.timelineStart,
    duration: opts.duration,
    speed: 1,
    reverse: false,
    frozen: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    blendMode: 'normal',
    color: {
      exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0,
    },
    audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
    effects: [],
    filters: [],
    transitions: [],
    keyframes: [],
    masks: [],
    slotId: opts.slotId,
    text: opts.kind === 'text' ? {
      text: opts.text || 'Your text',
      fontFamily: 'Inter',
      fontSize: 48,
      fontWeight: 700,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      align: 'center' as const,
      color: '#ffffff',
      animation: 'fade' as const,
    } : undefined,
    enabled: true,
  };
}

function buildTrack(id: string, kind: 'video' | 'audio' | 'text' | 'subtitle', name: string): any {
  return {
    id, kind, name, locked: false, hidden: false, solo: false, muted: false, height: 80,
  };
}

export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  // === §6 Social: TikTok ===
  {
    id: 'tpl-tiktok-viral-9x16',
    title: 'TikTok Viral',
    description: 'Punchy captions + beat sync. 15-second 9:16 vertical format.',
    category: 'Social',
    subcategory: 'TikTok',
    tags: ['tiktok', 'viral', 'vertical', 'social', 'short-form', 'beat-sync'],
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 15,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-main', 'video', 'Main'),
        buildTrack('tr-text', 'text', 'Text'),
      ],
      clips: [
        buildClip({
          id: 'clip-1', trackId: 'tr-main', kind: 'video',
          timelineStart: 0, duration: 15, slotId: 'slot-media-1',
        }),
        buildClip({
          id: 'clip-text-1', trackId: 'tr-text', kind: 'text',
          timelineStart: 0.5, duration: 3, slotId: 'slot-text-1', text: 'POV: when…',
        }),
        buildClip({
          id: 'clip-text-2', trackId: 'tr-text', kind: 'text',
          timelineStart: 4, duration: 3, slotId: 'slot-text-2', text: 'Wait for it',
        }),
        buildClip({
          id: 'clip-text-3', trackId: 'tr-text', kind: 'text',
          timelineStart: 8, duration: 3, slotId: 'slot-text-3', text: 'Did you see that?',
        }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-media-1', type: 'media', label: 'Main video', hint: '15s vertical clip', required: true, acceptedKinds: ['video'] },
      { id: 'slot-text-1', type: 'text', label: 'Hook text', required: true, defaultValue: 'POV: when…' },
      { id: 'slot-text-2', type: 'text', label: 'Build-up text', required: false, defaultValue: 'Wait for it' },
      { id: 'slot-text-3', type: 'text', label: 'Punchline text', required: false, defaultValue: 'Did you see that?' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },

  // === §6 Social: Instagram Reels ===
  {
    id: 'tpl-reels-promo-9x16',
    title: 'Reel Promo',
    description: 'Product showcase with bold captions. 30-second vertical.',
    category: 'Social',
    subcategory: 'Instagram Reels',
    tags: ['reels', 'instagram', 'product', 'promo', 'vertical'],
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 30,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-main', 'video', 'Main'),
        buildTrack('tr-text', 'text', 'Captions'),
      ],
      clips: [
        buildClip({
          id: 'clip-1', trackId: 'tr-main', kind: 'video',
          timelineStart: 0, duration: 10, slotId: 'slot-media-1',
        }),
        buildClip({
          id: 'clip-2', trackId: 'tr-main', kind: 'video',
          timelineStart: 10, duration: 10, slotId: 'slot-media-2',
        }),
        buildClip({
          id: 'clip-3', trackId: 'tr-main', kind: 'video',
          timelineStart: 20, duration: 10, slotId: 'slot-media-3',
        }),
        buildClip({
          id: 'clip-text-1', trackId: 'tr-text', kind: 'text',
          timelineStart: 1, duration: 4, slotId: 'slot-text-1', text: 'New Drop',
        }),
        buildClip({
          id: 'clip-text-2', trackId: 'tr-text', kind: 'text',
          timelineStart: 11, duration: 4, slotId: 'slot-text-2', text: 'Features',
        }),
        buildClip({
          id: 'clip-text-3', trackId: 'tr-text', kind: 'text',
          timelineStart: 21, duration: 4, slotId: 'slot-text-3', text: 'Shop now',
        }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-media-1', type: 'media', label: 'Opening shot', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-media-2', type: 'media', label: 'Feature shot', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-media-3', type: 'media', label: 'Closing shot', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-text-1', type: 'text', label: 'Opening text', required: true, defaultValue: 'New Drop' },
      { id: 'slot-text-2', type: 'text', label: 'Feature text', required: false, defaultValue: 'Features' },
      { id: 'slot-text-3', type: 'text', label: 'CTA text', required: true, defaultValue: 'Shop now' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },

  // === §6 Creator: YouTube Intro ===
  {
    id: 'tpl-youtube-intro-16x9',
    title: 'YouTube Intro',
    description: 'Branded intro animation. 8 seconds, 16:9.',
    category: 'Creator',
    subcategory: 'YouTube Intro',
    tags: ['youtube', 'intro', 'branded', 'cinematic'],
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 8,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-bg', 'video', 'Background'),
        buildTrack('tr-logo', 'video', 'Logo'),
        buildTrack('tr-text', 'text', 'Channel Name'),
      ],
      clips: [
        buildClip({
          id: 'clip-bg', trackId: 'tr-bg', kind: 'video',
          timelineStart: 0, duration: 8, slotId: 'slot-bg',
        }),
        buildClip({
          id: 'clip-logo', trackId: 'tr-logo', kind: 'image',
          timelineStart: 1, duration: 6, slotId: 'slot-logo',
        }),
        buildClip({
          id: 'clip-text-channel', trackId: 'tr-text', kind: 'text',
          timelineStart: 2, duration: 5, slotId: 'slot-channel-name', text: 'Your Channel',
        }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-bg', type: 'media', label: 'Background video', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-logo', type: 'logo', label: 'Brand logo', required: false, brandKitToken: 'logo', acceptedKinds: ['image'] },
      { id: 'slot-channel-name', type: 'text', label: 'Channel name', required: true, defaultValue: 'Your Channel' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },

  // === §6 Events: Birthday ===
  {
    id: 'tpl-birthday-wish-9x16',
    title: 'Birthday Wish',
    description: 'Festive celebration with photo montage. 20 seconds, vertical.',
    category: 'Events',
    subcategory: 'Birthday',
    tags: ['birthday', 'celebration', 'festive', 'photos', 'vertical'],
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 20,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-photos', 'video', 'Photos'),
        buildTrack('tr-text', 'text', 'Messages'),
      ],
      clips: [
        buildClip({ id: 'clip-p1', trackId: 'tr-photos', kind: 'image', timelineStart: 0, duration: 4, slotId: 'slot-photo-1' }),
        buildClip({ id: 'clip-p2', trackId: 'tr-photos', kind: 'image', timelineStart: 4, duration: 4, slotId: 'slot-photo-2' }),
        buildClip({ id: 'clip-p3', trackId: 'tr-photos', kind: 'image', timelineStart: 8, duration: 4, slotId: 'slot-photo-3' }),
        buildClip({ id: 'clip-p4', trackId: 'tr-photos', kind: 'image', timelineStart: 12, duration: 4, slotId: 'slot-photo-4' }),
        buildClip({ id: 'clip-p5', trackId: 'tr-photos', kind: 'image', timelineStart: 16, duration: 4, slotId: 'slot-photo-5' }),
        buildClip({ id: 'clip-t1', trackId: 'tr-text', kind: 'text', timelineStart: 0, duration: 4, slotId: 'slot-msg-1', text: 'Happy Birthday!' }),
        buildClip({ id: 'clip-t2', trackId: 'tr-text', kind: 'text', timelineStart: 8, duration: 4, slotId: 'slot-msg-2', text: 'Wishing you joy' }),
        buildClip({ id: 'clip-t3', trackId: 'tr-text', kind: 'text', timelineStart: 16, duration: 4, slotId: 'slot-msg-3', text: 'Celebrate!' }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-photo-1', type: 'media', label: 'Photo 1', required: true, acceptedKinds: ['image', 'video'] },
      { id: 'slot-photo-2', type: 'media', label: 'Photo 2', required: true, acceptedKinds: ['image', 'video'] },
      { id: 'slot-photo-3', type: 'media', label: 'Photo 3', required: true, acceptedKinds: ['image', 'video'] },
      { id: 'slot-photo-4', type: 'media', label: 'Photo 4', required: false, acceptedKinds: ['image', 'video'] },
      { id: 'slot-photo-5', type: 'media', label: 'Photo 5', required: false, acceptedKinds: ['image', 'video'] },
      { id: 'slot-msg-1', type: 'text', label: 'Opening message', required: true, defaultValue: 'Happy Birthday!' },
      { id: 'slot-msg-2', type: 'text', label: 'Middle message', required: false, defaultValue: 'Wishing you joy' },
      { id: 'slot-msg-3', type: 'text', label: 'Closing message', required: false, defaultValue: 'Celebrate!' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },

  // === §6 Business: Product Demo ===
  {
    id: 'tpl-product-demo-16x9',
    title: 'Product Demo',
    description: 'Feature-by-feature product walkthrough. 30 seconds, 16:9.',
    category: 'Business',
    subcategory: 'Product Launch',
    tags: ['product', 'demo', 'business', 'marketing', 'feature'],
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-main', 'video', 'Main'),
        buildTrack('tr-text', 'text', 'Features'),
      ],
      clips: [
        buildClip({ id: 'clip-1', trackId: 'tr-main', kind: 'video', timelineStart: 0, duration: 10, slotId: 'slot-media-1' }),
        buildClip({ id: 'clip-2', trackId: 'tr-main', kind: 'video', timelineStart: 10, duration: 10, slotId: 'slot-media-2' }),
        buildClip({ id: 'clip-3', trackId: 'tr-main', kind: 'video', timelineStart: 20, duration: 10, slotId: 'slot-media-3' }),
        buildClip({ id: 'clip-t1', trackId: 'tr-text', kind: 'text', timelineStart: 1, duration: 4, slotId: 'slot-text-1', text: 'Feature One' }),
        buildClip({ id: 'clip-t2', trackId: 'tr-text', kind: 'text', timelineStart: 11, duration: 4, slotId: 'slot-text-2', text: 'Feature Two' }),
        buildClip({ id: 'clip-t3', trackId: 'tr-text', kind: 'text', timelineStart: 21, duration: 4, slotId: 'slot-text-3', text: 'Get yours' }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-media-1', type: 'media', label: 'Feature 1 demo', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-media-2', type: 'media', label: 'Feature 2 demo', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-media-3', type: 'media', label: 'Closing shot', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-text-1', type: 'text', label: 'Feature 1 label', required: true, defaultValue: 'Feature One' },
      { id: 'slot-text-2', type: 'text', label: 'Feature 2 label', required: true, defaultValue: 'Feature Two' },
      { id: 'slot-text-3', type: 'text', label: 'CTA', required: true, defaultValue: 'Get yours' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },

  // === §6 Visual Styles: Cinematic ===
  {
    id: 'tpl-cinematic-trailer-21x9',
    title: 'Cinematic Trailer',
    description: 'Cinematic 21:9 trailer with dramatic text. 30 seconds.',
    category: 'Visual Styles',
    subcategory: 'Cinematic',
    tags: ['cinematic', 'trailer', 'dramatic', 'wide', 'film'],
    aspectRatio: '21:9',
    width: 2560,
    height: 1080,
    fps: 24,
    duration: 30,
    timelineData: {
      schemaVersion: 1,
      tracks: [
        buildTrack('tr-scene', 'video', 'Scene'),
        buildTrack('tr-title', 'text', 'Title Cards'),
      ],
      clips: [
        buildClip({ id: 'clip-s1', trackId: 'tr-scene', kind: 'video', timelineStart: 0, duration: 10, slotId: 'slot-scene-1' }),
        buildClip({ id: 'clip-s2', trackId: 'tr-scene', kind: 'video', timelineStart: 10, duration: 10, slotId: 'slot-scene-2' }),
        buildClip({ id: 'clip-s3', trackId: 'tr-scene', kind: 'video', timelineStart: 20, duration: 10, slotId: 'slot-scene-3' }),
        buildClip({ id: 'clip-t1', trackId: 'tr-title', kind: 'text', timelineStart: 2, duration: 6, slotId: 'slot-title-1', text: 'In a world…' }),
        buildClip({ id: 'clip-t2', trackId: 'tr-title', kind: 'text', timelineStart: 12, duration: 6, slotId: 'slot-title-2', text: 'One choice' }),
        buildClip({ id: 'clip-t3', trackId: 'tr-title', kind: 'text', timelineStart: 22, duration: 6, slotId: 'slot-title-3', text: 'Coming soon' }),
      ],
      markers: [],
    },
    slots: [
      { id: 'slot-scene-1', type: 'media', label: 'Opening scene', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-scene-2', type: 'media', label: 'Middle scene', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-scene-3', type: 'media', label: 'Closing scene', required: true, acceptedKinds: ['video', 'image'] },
      { id: 'slot-title-1', type: 'text', label: 'Opening title', required: true, defaultValue: 'In a world…' },
      { id: 'slot-title-2', type: 'text', label: 'Middle title', required: true, defaultValue: 'One choice' },
      { id: 'slot-title-3', type: 'text', label: 'Closing title', required: true, defaultValue: 'Coming soon' },
    ],
    tier: 'free',
    license: { type: 'cc0', commercialUse: true, attributionRequired: false },
    version: 1,
    isBuiltin: true,
  },
];

/**
 * V19 §8: Compute a real ranking score from actual usage metrics.
 *
 * NOT a fake popularity score — uses real DB-stored metrics:
 *   - usageCount (weight: 1.0)
 *   - likeCount (weight: 2.0)
 *   - saveCount (weight: 1.5)
 *   - shareCount (weight: 3.0)
 *   - completionRate (weight: 5.0) — most important signal
 *   - recencyBoost (boost for templates published in last 7 days)
 */
export function computeTemplateRank(metrics: {
  usageCount: number;
  likeCount: number;
  saveCount: number;
  shareCount: number;
  completionRate: number; // 0..1
  publishedAt: Date | null;
}): number {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const recencyBoost = metrics.publishedAt && (now - metrics.publishedAt.getTime()) < weekMs ? 1.5 : 1.0;
  const score = (
    metrics.usageCount * 1.0 +
    metrics.likeCount * 2.0 +
    metrics.saveCount * 1.5 +
    metrics.shareCount * 3.0 +
    metrics.completionRate * 100 * 5.0
  ) * recencyBoost;
  return Math.round(score * 100) / 100;
}
