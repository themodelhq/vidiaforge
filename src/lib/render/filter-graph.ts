// VidiaForge — Render filter graph builder
// Takes a ProjectDocument + asset refs and returns a structured filter graph
// (NOT a raw FFmpeg command). Consumed by FFmpegRenderService to emit a
// -filter_complex command.

import type { ProjectDocument, TimelineClip, TimelineTrack, AssetRef, Transform, ColorAdjust, AudioProperties, Effect, Filter, Transition, Keyframe, MaskShape, ChromaKey, CaptionCue } from '../types';
// V19.1.5: Static import for the keyframe evaluator — buildFilterGraph is synchronous
import { keyframesToFFmpegExpression } from './keyframe-evaluator';

// === Node type definitions ===

export type FilterNodeBase = {
  /** Stable label used as the FFmpeg filter chain stream name (e.g. [v0], [a0]). */
  id: string;
  /** Source node IDs feeding this node. */
  inputs: string[];
};

export type SourceNode = FilterNodeBase & {
  type: 'source';
  assetId: string;
  /** Storage key (for fetching local file). */
  storageKey: string;
  /** Optional local cached path. */
  localPath?: string;
  /** Trim source-side (in seconds). */
  sourceStart?: number;
  sourceEnd?: number;
  /** Stream kind. */
  kind: 'video' | 'audio' | 'image';
};

export type TrimNode = FilterNodeBase & {
  type: 'trim';
  start: number; // seconds within the source
  end: number; // seconds within the source
};

export type SpeedNode = FilterNodeBase & {
  type: 'speed';
  factor: number;
};

export type TransformNode = FilterNodeBase & {
  type: 'transform';
  transform: Transform;
  canvasWidth: number;
  canvasHeight: number;
};

export type CropNode = FilterNodeBase & {
  type: 'crop';
  top: number; right: number; bottom: number; left: number;
};

export type ColorNode = FilterNodeBase & {
  type: 'color';
  color: ColorAdjust;
};

export type EffectNode = FilterNodeBase & {
  type: 'effect';
  effect: Effect;
};

export type FilterNode = FilterNodeBase & {
  type: 'filter';
  filter: Filter;
};

export type MaskNode = FilterNodeBase & {
  type: 'mask';
  // V19 §21-22: extended shape union (was rectangle|circle|polygon) —
  // additive so existing MaskNode users still work. 'ellipse' is an alias
  // for circle/oval; 'freehand' is a special polygon with N points.
  shape: 'rectangle' | 'circle' | 'polygon' | 'ellipse' | 'freehand';
  feather: number;
  x: number; y: number; w: number; h: number; // normalized
  // === V19 §21-22 (additive) ===
  invert?: boolean;
  opacity?: number;       // 0..1 — overall mask opacity (multiplies alpha)
  rotation?: number;      // degrees around mask center
  /** Polygon / freehand points (normalized 0..1) */
  points?: { x: number; y: number }[];
  /** Per-property mask keyframes (x/y/w/h/feather) */
  keyframes?: Keyframe[];
};

export type TextNode = FilterNodeBase & {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  x: number; y: number; // normalized 0..1
  fontFamily?: string;
  fontStyle?: string;
  align?: 'left' | 'center' | 'right';
  start: number; end: number; // seconds within final timeline
  boxColor?: string;
  boxOpacity?: number;
};

export type AudioMixNode = FilterNodeBase & {
  type: 'audio_mix';
  volume: number; // 0..2
  pan: number; // -1..1
  fadeIn: number; // seconds
  fadeOut: number;
  muted: boolean;
  // === V19 §33 — actual chain duration so afade=t=out uses the correct
  // start time. Previously this was undefined and the render service fell
  // back to a 3s default — wrong for clips >3s.
  duration?: number;
};

export type CompositeNode = FilterNodeBase & {
  type: 'composite';
  /** Background stream (usually base video). */
  // (inputs[0] = base, inputs[1] = overlay)
  blendMode: string;
  /**
   * V19.1.5: Dynamic X/Y expressions for the overlay position.
   * These are FFmpeg expressions using `t` (time in seconds).
   * When set, the overlay filter uses: overlay=x='expr':y='expr'
   * When unset, defaults to 0:0.
   */
  overlayX?: string;
  overlayY?: string;
  /** Whether this is an audio composite (amix) vs video (overlay) */
  isAudio?: boolean;
};

export type TransitionNode = FilterNodeBase & {
  type: 'transition';
  transitionType: 'cut' | 'cross-dissolve' | 'fade' | 'dip-to-black' | 'dip-to-white' | 'wipe' | 'slide' | 'zoom' | 'blur';
  duration: number; // seconds
  offset: number; // seconds within final timeline
};

export type FadeNode = FilterNodeBase & {
  type: 'fade';
  fadeType: 'in' | 'out' | 'both';
  duration: number; // seconds
  color?: 'black' | 'white';
};

// === V19 §19 — Keyframe node (per-property time-varying filter chain) ===
/**
 * Emits a time-varying FFmpeg filter expression for a single animated
 * property. The render service translates this into the appropriate
 * `geq`/`scale`/`rotate`/`volume`/`colorchannelmixer` filter with `t`-based
 * expressions.
 *
 * One node per property per clip — multiple keyframe nodes can chain on the
 * same stream (e.g. one for opacity, one for scale).
 */
export type KeyframeNode = FilterNodeBase & {
  type: 'keyframe';
  /** Which property is animated. Drives the filter emitted by buildNodeFilter. */
  property: 'opacity' | 'scale' | 'rotation' | 'x' | 'y' | 'volume';
  /** Sorted keyframes (by time). The builder is responsible for sorting. */
  keyframes: Keyframe[];
  /** Clip duration in seconds (so the last segment extends to clip end). */
  clipDuration: number;
  /** Canvas width/height for scale/x/y expressions (px). */
  canvasWidth?: number;
  canvasHeight?: number;
};

// === V19 §23 — Chroma key node ===
export type ChromaKeyNode = FilterNodeBase & {
  type: 'chromakey';
  chromaKey: ChromaKey;
};

// === V19 §30 — Color Curves node ===
export type CurvesNode = FilterNodeBase & {
  type: 'curves';
  /** Master curve points (0..1 in/out) */
  master?: { in: number; out: number }[];
  red?: { in: number; out: number }[];
  green?: { in: number; out: number }[];
  blue?: { in: number; out: number }[];
};

// === V19 §30 — Color Wheels node (Lift/Gamma/Gain) ===
export type WheelsNode = FilterNodeBase & {
  type: 'wheels';
  lift:  { r: number; g: number; b: number };
  gamma: { r: number; g: number; b: number };
  gain:  { r: number; g: number; b: number };
  saturation?: number;
};

// === V19 §32 — LUT node ===
export type LutNode = FilterNodeBase & {
  type: 'lut';
  /** storageKey OR filePath to a .cube file. */
  storageKey?: string;
  filePath?: string;
  /** 0..1 mix (1 = full LUT). Implemented via lut3d + blend. */
  intensity: number;
  interp?: 'trilinear' | 'tetrahedral' | 'pyramid' | 'cube';
};

// === V19 §51 — Caption (multi-cue) node ===
/**
 * Emits one drawtext filter per cue (or per word for karaoke). Replaces the
 * single-cue TextNode path for caption clips. The render service chains the
 * drawtext filters on the input stream.
 */
export type CaptionNode = FilterNodeBase & {
  type: 'caption';
  cues: CaptionCue[];
  /** Clip-level fallback style (used when a cue has no per-cue overrides). */
  baseStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: number;
    italic?: boolean;
    backgroundColor?: string;
    borderWidth?: number;
    borderColor?: string;
    boxPadding?: number;
    highlightColor?: string;
  };
};

export type OutputNode = FilterNodeBase & {
  type: 'output';
  width: number;
  height: number;
  fps: number;
  format: 'yuv420p' | 'yuv444p' | 'yuv422p';
};

export type FilterGraphAnyNode =
  | SourceNode
  | TrimNode
  | SpeedNode
  | TransformNode
  | CropNode
  | ColorNode
  | EffectNode
  | FilterNode
  | MaskNode
  | TextNode
  | AudioMixNode
  | CompositeNode
  | TransitionNode
  | FadeNode
  | OutputNode
  | KeyframeNode
  | ChromaKeyNode
  | CurvesNode
  | WheelsNode
  | LutNode
  | CaptionNode;

export interface FilterGraph {
  nodes: FilterGraphAnyNode[];
  /** Final output video stream label (e.g. "vout"). */
  videoOut: string;
  /** Final output audio stream label (e.g. "aout"). */
  audioOut: string;
  /** Total expected duration (seconds). */
  duration: number;
}

// === Builder ===

/**
 * Build a filter graph from a project + assets. The graph is structured (not a raw
 * FFmpeg string) so other renderers (e.g. WebCodecs) could consume it later.
 *
 * Coverage:
 *  - Multiple video clips (sorted by timeline start, layered as overlays on a black base)
 *  - Multiple audio tracks (mixed into a single stream)
 *  - Trimming (sourceStart/sourceEnd)
 *  - Speed (sets PTS + atempo)
 *  - Scaling + positioning (transform.scale + transform.x/y)
 *  - Rotation (transform.rotation)
 *  - Opacity (transform.opacity)
 *  - Audio volume / pan / fades
 *  - Crossfades between sequential clips on the same track (xfade)
 *  - Text overlays (drawtext)
 *  - Basic filters (eq, vignette, blur)
 *  - Basic transitions (xfade family + fade/dip-to-black/dip-to-white/wipe/slide/zoom/blur)
 *
 * V19 (additive):
 *  - Keyframe rendering: per-property time-varying filters (§19)
 *  - Mask rendering: rectangle/circle/ellipse/polygon/freehand + feather/invert (§21-22)
 *  - Chroma key: chromakey filter + spill suppression (§23)
 *  - Color grading expansion: real highlights/shadows/whites/blacks, RGB curves,
 *    color wheels (lift/gamma/gain), 3D LUT via lut3d (§30-32)
 *  - Caption multi-cue rendering: per-cue drawtext + per-word karaoke + speaker (§51)
 *  - Multi-track video overlay compositing with blend modes (§82)
 *  - Audio fadeOut bug fix: actual chain duration threaded into AudioMixNode (§33)
 */
export function buildFilterGraph(
  project: ProjectDocument,
  assetsById: Record<string, AssetRef & { storageKey: string; localPath?: string }>
): FilterGraph {
  const nodes: FilterGraphAnyNode[] = [];
  const canvasW = project.project.width;
  const canvasH = project.project.height;
  const fps = project.project.fps;

  // Determine total duration
  const totalDuration = project.clips.reduce(
    (m, c) => Math.max(m, c.timelineStart + c.duration),
    0
  );

  // Group clips by track kind, ordered by timeline start
  const videoClips: Array<{ clip: TimelineClip; track: TimelineTrack }> = [];
  const audioClips: Array<{ clip: TimelineClip; track: TimelineTrack }> = [];
  const textClips: Array<{ clip: TimelineClip; track: TimelineTrack }> = [];
  const captionClips: Array<{ clip: TimelineClip; track: TimelineTrack }> = [];

  for (const clip of project.clips) {
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!track || track.hidden) continue;
    if (!clip.enabled) continue;
    if (clip.kind === 'video' || clip.kind === 'image') videoClips.push({ clip, track });
    else if (clip.kind === 'audio') audioClips.push({ clip, track });
    else if (clip.kind === 'text') {
      // V19 §51: clips with `caption` field are caption clips, not text overlays
      if (clip.caption && clip.caption.cues && clip.caption.cues.length > 0) {
        captionClips.push({ clip, track });
      } else {
        textClips.push({ clip, track });
      }
    }
  }

  videoClips.sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);
  audioClips.sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);

  // Helper: create a unique label
  let counter = 0;
  const label = (p: string): string => `${p}${counter++}`;

  // === VIDEO chains (per-clip) ===
  // V19 §82: clips are grouped by track AFTER per-clip sub-chain building, so
  // that inter-track overlay can be applied via CompositeNode with blendMode.
  // For now, collect (clip, chainEndId) pairs.
  const videoChainEnds: string[] = [];
  const videoChainMeta: Array<{ clip: TimelineClip; track: TimelineTrack; endId: string }> = [];
  const audioChainEnds: string[] = [];

  // Helper: compute the actual chain duration after trim + speed adjustments.
  function chainDurationFor(clip: TimelineClip): number {
    const srcSpan = Math.max(0, clip.sourceEnd - clip.sourceStart);
    return clip.speed > 0 ? srcSpan / clip.speed : srcSpan;
  }

  // Helper: emit keyframe nodes for a clip (per property with at least 2 keyframes).
  function emitKeyframeNodes(clip: TimelineClip, curIn: string, chainDur: number): string {
    let cur = curIn;
    if (!clip.keyframes || clip.keyframes.length < 1) return cur;
    // Group keyframes by property
    const grouped = new Map<string, Keyframe[]>();
    for (const kf of clip.keyframes) {
      if (!grouped.has(kf.property)) grouped.set(kf.property, []);
      grouped.get(kf.property)!.push(kf);
    }
    // Supported renderable properties — others (e.g. "pan") are skipped here
    const supported: KeyframeNode['property'][] = ['opacity', 'scale', 'rotation', 'x', 'y', 'volume'];
    for (const prop of supported) {
      const kfs = grouped.get(prop);
      if (!kfs || kfs.length < 2) continue;
      // Sort by time ascending
      const sorted = [...kfs].sort((a, b) => a.time - b.time);
      const kId = label('vkf');
      nodes.push({
        id: kId, inputs: [cur], type: 'keyframe',
        property: prop, keyframes: sorted,
        clipDuration: chainDur,
        canvasWidth: canvasW, canvasHeight: canvasH,
      });
      cur = kId;
    }
    return cur;
  }

  // Helper: emit mask nodes (one per mask in clip.masks).
  function emitMaskNodes(clip: TimelineClip, curIn: string): string {
    let cur = curIn;
    if (!clip.masks || clip.masks.length === 0) return cur;
    for (const mask of clip.masks) {
      const mId = label('vmask');
      // Map MaskShape.kind → MaskNode.shape (circle/ellipse map to same — circle
      // is preserved for backwards compat with existing single-emission code).
      const shape: MaskNode['shape'] =
        mask.kind === 'rectangle' ? 'rectangle'
        : mask.kind === 'polygon' ? 'polygon'
        : mask.kind === 'freehand' ? 'freehand'
        : mask.kind === 'circle' ? 'circle'
        : 'ellipse';
      nodes.push({
        id: mId, inputs: [cur], type: 'mask',
        shape, feather: mask.feather,
        x: mask.x, y: mask.y, w: mask.width, h: mask.height,
        invert: mask.invert,
        opacity: mask.opacity,
        rotation: mask.rotation,
        points: mask.points,
        keyframes: mask.keyframes,
      });
      cur = mId;
    }
    return cur;
  }

  // Helper: emit chroma key node.
  function emitChromaKeyNode(clip: TimelineClip, curIn: string): string {
    if (!clip.chromaKey || !clip.chromaKey.enabled) return curIn;
    const ckId = label('vck');
    nodes.push({ id: ckId, inputs: [curIn], type: 'chromakey', chromaKey: clip.chromaKey });
    return ckId;
  }

  // Helper: emit color grading expansion nodes (curves / wheels / lut).
  function emitColorGradingNodes(clip: TimelineClip, curIn: string): string {
    let cur = curIn;
    if (!clip.color) return cur;
    // RGB Curves
    if (clip.color.curves) {
      const c = clip.color.curves;
      const hasAny = (c.master && c.master.length >= 2) ||
                     (c.red && c.red.length >= 2) ||
                     (c.green && c.green.length >= 2) ||
                     (c.blue && c.blue.length >= 2);
      if (hasAny) {
        const cId = label('vcurves');
        nodes.push({
          id: cId, inputs: [cur], type: 'curves',
          master: c.master, red: c.red, green: c.green, blue: c.blue,
        });
        cur = cId;
      }
    }
    // Color Wheels
    if (clip.color.wheels) {
      const w = clip.color.wheels;
      const hasWheels =
        w.lift.r !== 0 || w.lift.g !== 0 || w.lift.b !== 0 ||
        w.gamma.r !== 0 || w.gamma.g !== 0 || w.gamma.b !== 0 ||
        w.gain.r !== 0 || w.gain.g !== 0 || w.gain.b !== 0 ||
        (w.saturation !== undefined && w.saturation !== 1);
      if (hasWheels) {
        const wId = label('vwheels');
        nodes.push({
          id: wId, inputs: [cur], type: 'wheels',
          lift: w.lift, gamma: w.gamma, gain: w.gain,
          saturation: w.saturation,
        });
        cur = wId;
      }
    }
    // LUT
    if (clip.color.lut && (clip.color.lut.storageKey || clip.color.lut.filePath)) {
      const lId = label('vlut');
      nodes.push({
        id: lId, inputs: [cur], type: 'lut',
        storageKey: clip.color.lut.storageKey,
        filePath: clip.color.lut.filePath,
        intensity: clip.color.lut.intensity,
        interp: clip.color.lut.interp,
      });
      cur = lId;
    }
    return cur;
  }

  for (const { clip } of videoClips) {
    const asset = clip.assetId ? assetsById[clip.assetId] : undefined;
    if (!asset) continue; // missing asset — skip honestly

    const srcId = label('vsrc');
    const sourceNode: SourceNode = {
      id: srcId, inputs: [], type: 'source',
      assetId: asset.id, storageKey: asset.storageKey, localPath: asset.localPath,
      sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd,
      kind: asset.kind === 'image' ? 'image' : 'video',
    };
    nodes.push(sourceNode);
    let cur = srcId;

    // Trim
    if (clip.sourceStart > 0 || clip.sourceEnd < (asset.duration ?? Infinity)) {
      const trimId = label('vtrim');
      nodes.push({
        id: trimId, inputs: [cur], type: 'trim',
        start: clip.sourceStart, end: Math.min(clip.sourceEnd, asset.duration ?? clip.sourceEnd),
      });
      cur = trimId;
    }

    // Speed
    if (clip.speed !== 1 && clip.speed > 0) {
      const spId = label('vspd');
      nodes.push({ id: spId, inputs: [cur], type: 'speed', factor: clip.speed });
      cur = spId;
    }

    // Crop
    if (clip.crop && (clip.crop.top || clip.crop.right || clip.crop.bottom || clip.crop.left)) {
      const cpId = label('vcrop');
      nodes.push({
        id: cpId, inputs: [cur], type: 'crop',
        top: clip.crop.top, right: clip.crop.right, bottom: clip.crop.bottom, left: clip.crop.left,
      });
      cur = cpId;
    }

    // Color
    if (hasColorAdjust(clip.color)) {
      const colId = label('vcol');
      nodes.push({ id: colId, inputs: [cur], type: 'color', color: clip.color });
      cur = colId;
    }

    // V19 §30-32: color grading expansion (curves / wheels / LUT)
    // Guarded by `clip.color.{curves,wheels,lut}` — additive, no-op when absent.
    cur = emitColorGradingNodes(clip, cur);

    // Effects (blur, vignette, etc.)
    for (const eff of clip.effects) {
      if (!eff.enabled) continue;
      const eId = label('veff');
      nodes.push({ id: eId, inputs: [cur], type: 'effect', effect: eff });
      cur = eId;
    }

    // Filters (cinematic, warm, etc.)
    for (const filt of clip.filters) {
      if (!filt.enabled) continue;
      const fId = label('vflt');
      nodes.push({ id: fId, inputs: [cur], type: 'filter', filter: filt });
      cur = fId;
    }

    // V19 §23: Chroma key (guarded by clip.chromaKey.enabled)
    cur = emitChromaKeyNode(clip, cur);

    // V19 §19: Keyframe rendering (guarded by clip.keyframes array length)
    const chainDur = chainDurationFor(clip);
    cur = emitKeyframeNodes(clip, cur, chainDur);

    // V19 §21-22: Mask rendering (guarded by clip.masks array length)
    cur = emitMaskNodes(clip, cur);

    // Transform (scale, position, rotation, opacity)
    const hasTransform =
      clip.transform.scale !== 1 ||
      clip.transform.x !== 0 ||
      clip.transform.y !== 0 ||
      clip.transform.rotation !== 0 ||
      clip.transform.opacity !== 1;
    if (hasTransform) {
      const tId = label('vxform');
      nodes.push({
        id: tId, inputs: [cur], type: 'transform',
        transform: clip.transform, canvasWidth: canvasW, canvasHeight: canvasH,
      });
      cur = tId;
    }

    // Audio fade
    if (clip.audio.fadeIn > 0 || clip.audio.fadeOut > 0) {
      const faId = label('vfade');
      nodes.push({
        id: faId, inputs: [cur], type: 'fade',
        fadeType: clip.audio.fadeIn > 0 && clip.audio.fadeOut > 0 ? 'both'
          : clip.audio.fadeIn > 0 ? 'in' : 'out',
        duration: Math.max(clip.audio.fadeIn, clip.audio.fadeOut),
      });
      cur = faId;
    }

    videoChainEnds.push(cur);
    videoChainMeta.push({ clip, track: project.tracks.find((t) => t.id === clip.trackId)!, endId: cur });
  }

  // === AUDIO chains ===
  for (const { clip } of audioClips) {
    const asset = clip.assetId ? assetsById[clip.assetId] : undefined;
    if (!asset) continue;
    const srcId = label('asrc');
    nodes.push({
      id: srcId, inputs: [], type: 'source',
      assetId: asset.id, storageKey: asset.storageKey, localPath: asset.localPath,
      sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd, kind: 'audio',
    });
    let cur = srcId;

    if (clip.sourceStart > 0 || clip.sourceEnd < (asset.duration ?? Infinity)) {
      const trimId = label('atrim');
      nodes.push({
        id: trimId, inputs: [cur], type: 'trim',
        start: clip.sourceStart, end: Math.min(clip.sourceEnd, asset.duration ?? clip.sourceEnd),
      });
      cur = trimId;
    }

    if (clip.speed !== 1 && clip.speed > 0) {
      const spId = label('aspd');
      nodes.push({ id: spId, inputs: [cur], type: 'speed', factor: clip.speed });
      cur = spId;
    }

    // V19 §19: emit audio keyframe nodes (volume property only).
    const aChainDur = chainDurationFor(clip);
    if (clip.keyframes && clip.keyframes.length >= 1) {
      const volKfs = clip.keyframes
        .filter((k) => k.property === 'volume')
        .sort((a, b) => a.time - b.time);
      if (volKfs.length >= 2) {
        const kId = label('akf');
        nodes.push({
          id: kId, inputs: [cur], type: 'keyframe',
          property: 'volume', keyframes: volKfs,
          clipDuration: aChainDur,
        });
        cur = kId;
      }
    }

    const mixId = label('amix');
    nodes.push({
      id: mixId, inputs: [cur], type: 'audio_mix',
      volume: clip.audio.volume, pan: clip.audio.pan,
      fadeIn: clip.audio.fadeIn, fadeOut: clip.audio.fadeOut, muted: clip.audio.muted,
      // V19 §33: thread the actual chain duration so afade=t=out uses the
      // correct start time (was undefined → fell back to 3s default, wrong for
      // clips longer than 3s).
      duration: aChainDur,
    });
    cur = mixId;

    audioChainEnds.push(cur);
  }

  // === TEXT overlays ===
  // V9: Text overlays are drawtext filters that CHAIN onto the video stream,
  // not standalone filters. Each text node takes the current video chain end
  // as input and outputs a new labeled stream.
  for (const { clip } of textClips) {
    if (!clip.text) continue;
    const tId = label('txt');
    // Chain onto the last video chain end — drawtext overlays text on the video
    const videoInput = videoChainEnds.length > 0 ? videoChainEnds[videoChainEnds.length - 1] : null;
    nodes.push({
      id: tId, inputs: videoInput ? [videoInput] : [], type: 'text',
      text: clip.text.text,
      fontSize: clip.text.fontSize,
      color: clip.text.color,
      x: 0.5, y: 0.5, // text clips use transform for positioning; center default
      fontFamily: clip.text.fontFamily,
      fontStyle: clip.text.italic ? 'italic' : 'normal',
      align: clip.text.align,
      start: clip.timelineStart,
      end: clip.timelineStart + clip.duration,
      boxColor: clip.text.background?.color,
      boxOpacity: clip.text.background ? 1 : undefined,
    });
    // Replace the last video chain end with this text node
    if (videoInput) {
      videoChainEnds[videoChainEnds.length - 1] = tId;
    } else {
      videoChainEnds.push(tId);
    }
  }

  // === V19 §51: CAPTION (multi-cue) overlays ===
  // Caption clips emit a CaptionNode that emits one drawtext per cue (or per
  // word for karaoke). Like text overlays, they chain onto the current video
  // stream end so drawtext layers stack on top of the base.
  for (const { clip } of captionClips) {
    if (!clip.caption || !clip.caption.cues || clip.caption.cues.length === 0) continue;
    const cId = label('cap');
    const videoInput = videoChainEnds.length > 0 ? videoChainEnds[videoChainEnds.length - 1] : null;
    // Build a base style from the clip's text field (if present) — used as a
    // fallback when per-cue style overrides are absent.
    const baseStyle: CaptionNode['baseStyle'] = clip.text ? {
      fontFamily: clip.text.fontFamily,
      fontSize: clip.text.fontSize,
      color: clip.text.color,
      fontWeight: clip.text.fontWeight,
      italic: clip.text.italic,
      backgroundColor: clip.text.background?.color,
      borderWidth: clip.text.stroke?.width,
      borderColor: clip.text.stroke?.color,
    } : undefined;
    nodes.push({
      id: cId, inputs: videoInput ? [videoInput] : [], type: 'caption',
      cues: clip.caption.cues, baseStyle,
    });
    if (videoInput) {
      videoChainEnds[videoChainEnds.length - 1] = cId;
    } else {
      videoChainEnds.push(cId);
    }
  }

  // === Transitions (xfade between sequential video chains) ===
  // V19 §82: Multi-track overlay — group clips by track, build per-track
  // sequential chains (existing behavior), then composite tracks top-down.
  let vout = '';
  if (videoChainEnds.length === 0) {
    // No video — create a black background source
    const blackId = label('vblk');
    nodes.push({
      id: blackId, inputs: [], type: 'source',
      assetId: '__black__', storageKey: '__black__', kind: 'image',
    });
    vout = blackId;
  } else if (videoChainEnds.length === 1) {
    // V19.1.5: Check if the single clip has X/Y keyframes or non-zero transform.
    // If so, we need to create a black background + overlay the clip on it
    // with time-varying X/Y position (the compositor step).
    const singleClip = videoClips[0]?.clip;
    const hasXYKeyframes = singleClip?.keyframes?.some(
      (k) => k.property === 'x' || k.property === 'y',
    ) ?? false;
    const hasTransform = singleClip &&
      (singleClip.transform.x !== 0 || singleClip.transform.y !== 0);

    if (hasXYKeyframes || hasTransform) {
      // V19.1.5 §9-10: Create a canvas-sized black background + overlay
      // the clip on top with dynamic X/Y from keyframe expressions.
      const blackId = label('vblk');
      nodes.push({
        id: blackId, inputs: [], type: 'source',
        assetId: '__black__', storageKey: '__black__', kind: 'image',
      });

      // V19.1.5 §6: Generate the X/Y FFmpeg expression from keyframes
      // using the SAME keyframe evaluator used by all other properties.
      

      // V19.1.5 §13: Convert normalized coordinates to pixel coordinates.
      // x=0.1 means the clip's left edge is at 10% of (canvasWidth - clipWidth).
      // The overlay filter's x/y is the top-left pixel of the overlay.
      const xKeyframes = singleClip!.keyframes?.filter((k) => k.property === 'x') || [];
      const yKeyframes = singleClip!.keyframes?.filter((k) => k.property === 'y') || [];

      let overlayX: string | undefined;
      let overlayY: string | undefined;

      if (xKeyframes.length >= 2) {
        // V19.1.5: Generate the FFmpeg expression for X(t)
        const xExpr = keyframesToFFmpegExpression(xKeyframes);
        if (xExpr && xExpr !== 'null' && xExpr !== '') {
          // V19.1.5 §13: Convert normalized 0..1 to pixel offset.
          // overlay_x = normalized_x * (canvasW - clipRenderedW)
          // For a 40px clip on a 200px canvas: x=0.1 → 0.1 * 160 = 16px
          // We use W (source width) + w (overlay width) in the expression.
          // FFmpeg overlay supports: W (background width), w (overlay width)
          overlayX = `(${xExpr})*(W-w)`;
        }
      } else if (singleClip!.transform.x !== 0) {
        // V19.1.5: Static transform.x — convert from pixels (or normalized) to overlay position
        // transform.x is in pixels; just use it directly
        overlayX = String(singleClip!.transform.x);
      }

      if (yKeyframes.length >= 2) {
        const yExpr = keyframesToFFmpegExpression(yKeyframes);
        if (yExpr && yExpr !== 'null' && yExpr !== '') {
          overlayY = `(${yExpr})*(H-h)`;
        }
      } else if (singleClip!.transform.y !== 0) {
        overlayY = String(singleClip!.transform.y);
      }

      // V19.1.5: Create the composite node with dynamic X/Y
      const compId = label('vcomp');
      nodes.push({
        id: compId,
        inputs: [blackId, videoChainEnds[0]],
        type: 'composite',
        blendMode: 'normal',
        overlayX,
        overlayY,
      });
      vout = compId;
    } else {
      // No X/Y keyframes or transform — clip goes straight to output
      vout = videoChainEnds[0];
    }
  } else {
    // V19 §82: detect multi-track. Group videoChainMeta by trackId.
    const trackGroups = new Map<string, Array<{ clip: TimelineClip; track: TimelineTrack; endId: string }>>();
    for (const meta of videoChainMeta) {
      const tid = meta.clip.trackId;
      if (!trackGroups.has(tid)) trackGroups.set(tid, []);
      trackGroups.get(tid)!.push(meta);
    }
    // Sort within each track by timelineStart (already sorted globally, but
    // ensure each group is also timelineStart-sorted).
    for (const group of trackGroups.values()) {
      group.sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);
    }
    // Get unique trackIds in project track order (lower index = bottom layer).
    const trackOrder = project.tracks
      .map((t, i) => ({ id: t.id, i }))
      .filter((t) => trackGroups.has(t.id))
      .sort((a, b) => a.i - b.i)
      .map((t) => t.id);

    if (trackOrder.length <= 1) {
      // Single track — preserve existing xfade-between-sequential behavior.
      let cur = videoChainEnds[0];
      const firstClipStart = videoClips[0]?.clip.timelineStart ?? 0;
      let offset = firstClipStart;
      for (let i = 1; i < videoChainEnds.length; i++) {
        const prev = videoClips[i - 1];
        const transition = prev?.clip.transitions.find((t) => t.type !== 'cut');
        const transitionDuration = transition?.duration ?? 0.5;
        const transType: TransitionNode['transitionType'] =
          transition ? mapTransitionType(transition.type) : 'cross-dissolve';
        offset = (videoClips[i]?.clip.timelineStart ?? offset) - transitionDuration;
        const xId = label('xv');
        nodes.push({
          id: xId, inputs: [cur, videoChainEnds[i]], type: 'transition',
          transitionType: transType, duration: transitionDuration,
          offset: Math.max(0, offset),
        });
        cur = xId;
        offset += transitionDuration;
      }
      vout = cur;
    } else {
      // V19 §82: Multi-track composite. Build per-track sequential chains via
      // xfade (existing behavior), then composite via overlay (lower track =
      // background, upper track = overlay). blendMode is taken from the upper
      // clip (per-clip.blendMode).
      const trackChainEnds: string[] = [];
      for (const tid of trackOrder) {
        const group = trackGroups.get(tid)!;
        let cur = group[0].endId;
        // Sequential xfade within this track (if > 1 clip)
        for (let i = 1; i < group.length; i++) {
          const prev = group[i - 1];
          const next = group[i];
          const transition = prev.clip.transitions.find((t) => t.type !== 'cut');
          const transitionDuration = transition?.duration ?? 0.5;
          const transType: TransitionNode['transitionType'] =
            transition ? mapTransitionType(transition.type) : 'cross-dissolve';
          const offset = Math.max(0, next.clip.timelineStart - transitionDuration);
          const xId = label('xv');
          nodes.push({
            id: xId, inputs: [cur, next.endId], type: 'transition',
            transitionType: transType, duration: transitionDuration,
            offset,
          });
          cur = xId;
        }
        trackChainEnds.push(cur);
      }
      // Composite tracks bottom-up via overlay with blend mode.
      let cur = trackChainEnds[0];
      for (let i = 1; i < trackChainEnds.length; i++) {
        const overlayClip = trackGroups.get(trackOrder[i])![0].clip;
        const blendMode = overlayClip.blendMode || 'normal';

        // V19.1.5: Generate X/Y expressions from the overlay clip's keyframes
        
        const xKfs = overlayClip.keyframes?.filter((k) => k.property === 'x') || [];
        const yKfs = overlayClip.keyframes?.filter((k) => k.property === 'y') || [];
        let overlayX: string | undefined;
        let overlayY: string | undefined;
        if (xKfs.length >= 2) {
          const xExpr = keyframesToFFmpegExpression(xKfs);
          if (xExpr && xExpr !== 'null' && xExpr !== '') {
            overlayX = `(${xExpr})*(W-w)`;
          }
        }
        if (yKfs.length >= 2) {
          const yExpr = keyframesToFFmpegExpression(yKfs);
          if (yExpr && yExpr !== 'null' && yExpr !== '') {
            overlayY = `(${yExpr})*(H-h)`;
          }
        }

        const cId = label('vcomp');
        nodes.push({
          id: cId, inputs: [cur, trackChainEnds[i]], type: 'composite',
          blendMode,
          overlayX,
          overlayY,
        });
        cur = cId;
      }
      vout = cur;
    }
  }

  // Final output scaling node (scales to canvas size + sets fps)
  const outId = label('vout');
  nodes.push({
    id: outId, inputs: [vout], type: 'output',
    width: canvasW, height: canvasH, fps, format: 'yuv420p',
  });

  // === AUDIO mix ===
  let aout = '';
  if (audioChainEnds.length === 0) {
    // Silent audio source
    const silentId = label('asil');
    nodes.push({
      id: silentId, inputs: [], type: 'source',
      assetId: '__silent__', storageKey: '__silent__', kind: 'audio',
    });
    aout = silentId;
  } else if (audioChainEnds.length === 1) {
    aout = audioChainEnds[0];
  } else {
    const mixId = label('aout');
    nodes.push({
      id: mixId, inputs: audioChainEnds, type: 'composite',
      blendMode: 'normal',
    });
    aout = mixId;
  }

  return {
    nodes,
    videoOut: outId,
    audioOut: aout,
    duration: totalDuration,
  };
}

function hasColorAdjust(c: ColorAdjust): boolean {
  return (
    c.exposure !== 0 ||
    c.brightness !== 0 ||
    c.contrast !== 0 ||
    c.highlights !== 0 ||
    c.shadows !== 0 ||
    c.whites !== 0 ||
    c.blacks !== 0 ||
    c.saturation !== 0 ||
    c.vibrance !== 0 ||
    c.temperature !== 0 ||
    c.tint !== 0 ||
    c.hue !== 0
  );
}

function mapTransitionType(t: Transition['type']): TransitionNode['transitionType'] {
  switch (t) {
    case 'cross-dissolve': return 'cross-dissolve';
    case 'fade': return 'fade';
    case 'dip-to-black': return 'dip-to-black';
    case 'dip-to-white': return 'dip-to-white';
    case 'wipe': return 'wipe';
    case 'slide': return 'slide';
    case 'zoom': return 'zoom';
    case 'blur': return 'blur';
    default: return 'cross-dissolve';
  }
}
