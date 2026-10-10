// VidiaForge — Shared Type Definitions
// Non-destructive, versioned project schema for the timeline engine.

export type CanvasPreset =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:5'
  | '4:3'
  | '21:9'
  | 'custom';

export type ResolutionPreset = '480p' | '720p' | '1080p' | '1440p' | '4K';
export type FpsPreset = 24 | 25 | 30 | 50 | 60;

export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  fps: number;
  canvasPreset: CanvasPreset;
  resolution: ResolutionPreset;
  duration: number;
  thumbnailUrl?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export type TrackKind =
  | 'video'
  | 'audio'
  | 'text'
  | 'subtitle'
  | 'overlay'
  | 'adjustment';

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  solo: boolean;
  muted: boolean;
  height: number;
  color?: string;
}

export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'effect' | 'sticker' | 'shape' | 'adjustment';

export interface Transform {
  x: number; // px offset from center
  y: number;
  scale: number; // 1 = 100%
  rotation: number; // degrees
  opacity: number; // 0..1
  anchorX: number; // 0..1 normalized
  anchorY: number;
}

export interface Crop {
  top: number; // 0..1 normalized
  right: number;
  bottom: number;
  left: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

export interface ColorAdjust {
  exposure: number;   // -1..1
  brightness: number; // -1..1
  contrast: number;   // -1..1
  highlights: number; // -1..1
  shadows: number;    // -1..1
  whites: number;     // -1..1
  blacks: number;     // -1..1
  saturation: number; // -1..1
  vibrance: number;   // -1..1
  temperature: number; // -1..1
  tint: number;       // -1..1
  hue: number;        // -180..180
  // === V19 §30-32 (additive) — RGB Curves, Color Wheels, LUT ===
  // All optional so existing projects (without these fields) continue to render unchanged.
  curves?: ColorCurves;
  wheels?: ColorWheels;
  lut?: LutRef;
}

/**
 * V19 §30 RGB Curves. Each channel is a list of {input,output} control points
 * (both normalized 0..1). FFmpeg `curves` filter interpolates linearly between
 * points. Empty array = no-op for that channel.
 */
export interface ColorCurves {
  master?: CurvePoint[];
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
}

export interface CurvePoint {
  /** Input value 0..1 */
  in: number;
  /** Output value 0..1 */
  out: number;
}

/**
 * V19 §30 Color Wheels — Lift / Gamma / Gain per RGB channel.
 * Each component is -1..1 (0 = neutral). Lift shifts shadows, gamma shifts
 * midtones, gain shifts highlights.
 */
export interface ColorWheels {
  lift:   { r: number; g: number; b: number };
  gamma:  { r: number; g: number; b: number };
  gain:   { r: number; g: number; b: number };
  /** Optional saturation master 0..2 (1 = unchanged) */
  saturation?: number;
}

/**
 * V19 §32 LUT reference. Either storageKey (resolved via getStorage()) or
 * a direct filePath on disk. The render service downloads the LUT to a tmp
 * file and passes the path to FFmpeg's lut3d filter.
 */
export interface LutRef {
  storageKey?: string;
  filePath?: string;
  /** 0..1 mix between original and LUT-graded image (1 = full LUT) */
  intensity: number;
  /** LUT interpolation method */
  interp?: 'trilinear' | 'tetrahedral' | 'pyramid' | 'cube';
}

/**
 * V19 §23 Chroma Key. When `enabled` is true, the render pipeline emits an
 * FFmpeg `chromakey` filter (color:similarity:blend) followed by optional
 * `colorchannelmixer` for green spill suppression.
 */
export interface ChromaKey {
  enabled: boolean;
  /** Target color as hex string (e.g. "#00FF00" for green screen) */
  color: string;
  /** 0..1 — how close a pixel's color must be to be keyed out */
  similarity: number;
  /** 0..1 — edge blend softness */
  smoothness: number;
  /** 0..1 — green spill suppression strength (colorchannelmixer green reduction) */
  spillSuppression: number;
  /** 0..1 — edge softness for the alpha matte (gblur sigma on alpha) */
  edgeSoftness: number;
  /** 0..1 — preserve shadow detail (higher = more transparency retained) */
  shadowPreservation: number;
}

export interface AudioProperties {
  volume: number;     // 0..2 (1 = 100%)
  pan: number;        // -1..1
  fadeIn: number;     // seconds
  fadeOut: number;    // seconds
  muted: boolean;
}

export type EffectType =
  | 'blur'
  | 'gaussian-blur'
  | 'motion-blur'
  | 'glow'
  | 'sharpen'
  | 'vignette'
  | 'noise'
  | 'grain'
  | 'chromatic-aberration'
  | 'glitch'
  | 'pixelate'
  | 'vhs'
  | 'film'
  | 'rgb-split'
  | 'lens-distortion'
  | 'bloom';

export interface Effect {
  id: string;
  type: EffectType;
  intensity: number; // 0..1
  enabled: boolean;
  params?: Record<string, number>;
}

export type FilterType =
  | 'cinematic'
  | 'warm'
  | 'cool'
  | 'vintage'
  | 'film'
  | 'bw'
  | 'high-contrast'
  | 'moody'
  | 'vibrant'
  | 'portrait'
  | 'golden-hour';

export interface Filter {
  id: string;
  type: FilterType;
  intensity: number; // 0..1
  enabled: boolean;
}

export type TransitionType =
  | 'cut'
  | 'cross-dissolve'
  | 'fade'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'wipe'
  | 'slide'
  | 'zoom'
  | 'blur'
  | 'spin'
  | 'glitch'
  | 'light-leak'
  | 'film-burn'
  | 'flash'
  | 'whip-pan'
  | 'morph'
  | 'push';

export interface Transition {
  id: string;
  type: TransitionType;
  duration: number; // seconds
}

export type EasingType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic'
  | 'bezier';

export interface Keyframe {
  id: string;
  time: number; // seconds (relative to clip start)
  property: string;
  value: number;
  easing: EasingType;
  bezier?: [number, number, number, number];
}

export interface MaskShape {
  id: string;
  kind: 'rectangle' | 'circle' | 'polygon' | 'freehand' | 'ellipse';
  feather: number;
  opacity: number;
  expansion: number;
  points?: { x: number; y: number }[]; // for polygon/freehand (normalized 0..1)
  x: number; // position normalized
  y: number;
  width: number;
  height: number;
  // === V19 §21-22 (additive) — invert + keyframes ===
  invert?: boolean;
  /** Optional rotation in degrees around the mask center */
  rotation?: number;
  /** Optional per-property keyframes (x/y/width/height/feather) for animated masks */
  keyframes?: Keyframe[];
}

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  color: string;
  gradient?: { from: string; to: string; angle: number };
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  background?: { color: string; rounded: number; padding: number };
  animation?: 'none' | 'fade' | 'typewriter' | 'pop' | 'bounce' | 'slide' | 'zoom' | 'glitch' | 'word' | 'char';
}

export interface CaptionCue {
  id: string;
  start: number; // timeline seconds
  end: number;
  text: string;
  speaker?: string;
  words?: { text: string; start: number; end: number }[];
  // === V19 §51 (additive) — per-cue styling overrides ===
  style?: CaptionCueStyle;
}

/**
 * V19 §51 per-cue caption styling. All fields optional — falls back to the
 * clip-level TextStyle when unset.
 */
export interface CaptionCueStyle {
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  fontWeight?: number;
  italic?: boolean;
  backgroundColor?: string;
  /** Border (stroke) width in px */
  borderWidth?: number;
  borderColor?: string;
  /** Box padding in px */
  boxPadding?: number;
  /** Highlighted word color (for karaoke-style captions) */
  highlightColor?: string;
  /** X position normalized 0..1 (defaults to 0.5 = centered) */
  x?: number;
  /** Y position normalized 0..1 (defaults to 0.85 = lower third) */
  y?: number;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  kind: ClipKind;

  // Asset reference (for video/audio/image clips)
  assetId?: string;
  assetName?: string;

  // Source in/out (non-destructive)
  sourceStart: number; // seconds within source asset
  sourceEnd: number;

  // Timeline placement
  timelineStart: number;
  duration: number; // = sourceEnd - sourceStart (unless speed != 1)

  speed: number; // 1 = normal
  reverse: boolean;
  frozen?: { at: number; duration: number } | null;

  transform: Transform;
  crop: Crop;
  blendMode: BlendMode;

  color: ColorAdjust;
  audio: AudioProperties;

  effects: Effect[];
  filters: Filter[];
  transitions: Transition[];
  keyframes: Keyframe[];
  masks: MaskShape[];

  // === V19 §23 (additive) — Chroma Key ===
  chromaKey?: ChromaKey;

  // Text-specific
  text?: TextStyle;

  // Caption-specific
  caption?: { cues: CaptionCue[]; style: string };

  // Display
  label?: string;
  // V19: rename ambiguous `color?` (was used for the clip-label color in the UI)
  // to `labelColor` so it no longer collides with `color: ColorAdjust`.
  labelColor?: string;
  thumbnailUrl?: string;
  waveformUrl?: string;

  // Linking / grouping
  linkedClipIds?: string[];
  groupId?: string;

  enabled: boolean;
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  note?: string;
}

export interface TimelineState {
  schemaVersion: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  inPoint?: number;
  outPoint?: number;
}

export interface ProjectDocument {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    canvasPreset: CanvasPreset;
    resolution: ResolutionPreset;
  };
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  assets: AssetRef[];
}

export interface AssetRef {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  mimeType: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  thumbnailUrl?: string;
  waveformUrl?: string;
  storagePath: string;
  status?: 'uploading' | 'processing' | 'ready' | 'failed';
  errorMessage?: string;
}

export interface MediaAssetDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: 'video' | 'audio' | 'image';
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  thumbnailUrl?: string;
  waveformUrl?: string;
  createdAt: string;
}

export interface RenderJobDTO {
  id: string;
  projectId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  format: string;
  codec: string;
  resolution: string;
  fps: number;
  bitrate: string;
  progress: number;
  stage?: string;
  outputUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export type ViewName = 'landing' | 'login' | 'register' | 'dashboard' | 'editor' | 'settings';

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  plan: string;
  createdAt: string;
}
