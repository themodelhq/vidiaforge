// VidiaForge — Timeline factory & helpers
// Pure functions for creating/manipulating timeline state. Non-destructive.

import type {
  TimelineTrack,
  TimelineClip,
  ProjectDocument,
  TimelineState,
  CanvasPreset,
  ResolutionPreset,
  Transform,
  ColorAdjust,
  AudioProperties,
  Crop,
} from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };
}

export function defaultCrop(): Crop {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function defaultColor(): ColorAdjust {
  return {
    exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0,
    whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0,
  };
}

export function defaultAudio(): AudioProperties {
  return { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false };
}

export function createTrack(kind: TimelineTrack['kind'], name?: string): TimelineTrack {
  const names: Record<TimelineTrack['kind'], string> = {
    video: 'Video',
    audio: 'Audio',
    text: 'Text',
    subtitle: 'Subtitles',
    overlay: 'Overlay',
    adjustment: 'Adjustment',
  };
  return {
    id: uid('trk'),
    kind,
    name: name ?? names[kind],
    locked: false,
    hidden: false,
    solo: false,
    muted: false,
    height: kind === 'audio' ? 64 : 56,
  };
}

export function createClip(params: Partial<TimelineClip> & { trackId: string; kind: TimelineClip['kind'] }): TimelineClip {
  return {
    id: uid('clip'),
    sourceStart: 0,
    sourceEnd: params.duration ?? 5,
    timelineStart: 0,
    duration: params.duration ?? 5,
    speed: 1,
    reverse: false,
    frozen: null,
    transform: defaultTransform(),
    crop: defaultCrop(),
    blendMode: 'normal',
    color: defaultColor(),
    audio: defaultAudio(),
    effects: [],
    filters: [],
    transitions: [],
    keyframes: [],
    masks: [],
    enabled: true,
    ...params,
  };
}

export function emptyTimelineState(): TimelineState {
  return {
    schemaVersion: 1,
    tracks: [
      createTrack('video'),
      createTrack('audio'),
      createTrack('text'),
    ],
    clips: [],
    markers: [],
  };
}

export function emptyProjectDocument(projectId: string, name: string): ProjectDocument {
  const ts = emptyTimelineState();
  return {
    schemaVersion: 1,
    project: {
      id: projectId,
      name,
      width: 1920,
      height: 1080,
      fps: 30,
      canvasPreset: '16:9',
      resolution: '1080p',
    },
    tracks: ts.tracks,
    clips: ts.clips,
    markers: ts.markers,
    assets: [],
  };
}

// Canvas preset → dimensions (at 1080p baseline)
export const CANVAS_DIMENSIONS: Record<CanvasPreset, { width: number; height: number; label: string }> = {
  '16:9': { width: 1920, height: 1080, label: 'YouTube / Landscape' },
  '9:16': { width: 1080, height: 1920, label: 'TikTok / Reels / Shorts' },
  '1:1': { width: 1080, height: 1080, label: 'Instagram Square' },
  '4:5': { width: 1080, height: 1350, label: 'Instagram Portrait' },
  '4:3': { width: 1440, height: 1080, label: 'Classic 4:3' },
  '21:9': { width: 2560, height: 1080, label: 'Cinematic' },
  custom: { width: 1920, height: 1080, label: 'Custom' },
};

export const RESOLUTION_MULTIPLIER: Record<ResolutionPreset, number> = {
  '480p': 0.25,
  '720p': 0.5,
  '1080p': 1,
  '1440p': 1.5,
  '4K': 2,
};

export function resolutionFor(canvas: CanvasPreset, resolution: ResolutionPreset) {
  const base = CANVAS_DIMENSIONS[canvas];
  const m = RESOLUTION_MULTIPLIER[resolution];
  return {
    width: Math.round((base.width * m) / 2) * 2,
    height: Math.round((base.height * m) / 2) * 2,
  };
}

// Timecode formatting
export function formatTimecode(seconds: number, fps: number = 30, format: 'hhmmssff' | 'seconds' = 'hhmmssff'): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  if (format === 'seconds') {
    return seconds.toFixed(3).padStart(7, '0');
  }
  const totalFrames = Math.round(seconds * fps);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Compute project duration = max clip timelineEnd
export function computeDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  return clips.reduce((max, c) => Math.max(max, c.timelineStart + c.duration), 0);
}

// Snap helper
export function snap(value: number, targets: number[], threshold = 0.25): { value: number; snapped: boolean } {
  let best = value;
  let bestDist = threshold;
  let snapped = false;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
      snapped = true;
    }
  }
  return { value: best, snapped };
}
