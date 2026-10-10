// VidiaForge — AI command executor
// Takes validated commands and applies them to the editor store via existing store actions.
// Each command type maps to one or more store mutations. Wraps everything in a single
// history entry ("Apply AI edits").

import type { AICommand } from './schema';
import type { EditorState } from '@/stores/editor-store';

export interface ExecutionReport {
  applied: number;
  skipped: number;
  errors: string[];
}

/**
 * Execute a list of validated AI commands against the editor store.
 * The caller must provide the live store instance (useEditorStore).
 * Single history entry wraps all mutations ("Apply AI edits").
 *
 * Note: this module is a CLIENT-SIDE utility — it must NOT be imported from
 * any server-side code (it touches Zustand directly).
 */
export function executeCommands(
  commands: AICommand[],
  store: { getState: () => EditorState }
): ExecutionReport {
  const state = store.getState();
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Open a single history entry capturing the PRE-state
  state.pushHistory('Apply AI edits');

  const existingClipIds = new Set(state.clips.map((c) => c.id));

  for (const cmd of commands) {
    try {
      const result = applyCommand(cmd, store, existingClipIds);
      if (result === 'applied') applied++;
      else if (result === 'skipped') skipped++;
    } catch (err) {
      skipped++;
      errors.push(`${cmd.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Schedule save once for the whole batch
  state.scheduleSave();

  return { applied, skipped, errors };
}

function applyCommand(
  cmd: AICommand,
  store: { getState: () => EditorState },
  existingClipIds: Set<string>
): 'applied' | 'skipped' {
  const s = store.getState();

  switch (cmd.type) {
    case 'trim_clip': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === cmd.clipId);
      if (!clip) return 'skipped';
      const newSourceStart = cmd.start != null ? cmd.start : clip.sourceStart;
      const newSourceEnd = cmd.end != null ? cmd.end : clip.sourceEnd;
      const newDuration = Math.max(0.05, (newSourceEnd - newSourceStart) / clip.speed);
      s.updateClipSilent(cmd.clipId, {
        sourceStart: newSourceStart,
        sourceEnd: newSourceEnd,
        duration: newDuration,
      });
      return 'applied';
    }

    case 'split_clip': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      s.splitClip(cmd.clipId, cmd.time);
      return 'applied';
    }

    case 'delete_clip': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      s.selectClips([cmd.clipId]);
      s.deleteSelected();
      return 'applied';
    }

    case 'move_clip': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      s.moveClip(cmd.clipId, cmd.toTimelineStart, cmd.toTrackId);
      return 'applied';
    }

    case 'change_speed': {
      const clipId = cmd.clipId ?? s.selectedClipIds[0];
      if (!clipId || !existingClipIds.has(clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return 'skipped';
      s.updateClipSilent(clipId, { speed: cmd.factor });
      return 'applied';
    }

    case 'change_volume': {
      const clipId = cmd.clipId ?? s.selectedClipIds[0];
      if (!clipId || !existingClipIds.has(clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return 'skipped';
      s.updateClipSilent(clipId, { audio: { ...clip.audio, volume: cmd.volume } });
      return 'applied';
    }

    case 'add_text': {
      // Find a text track or create one
      let textTrack = s.tracks.find((t) => t.kind === 'text');
      if (!textTrack) {
        s.addTrack('text');
        const newState = store.getState();
        textTrack = newState.tracks.find((t) => t.kind === 'text');
        if (!textTrack) return 'skipped';
      }
      // Create text clip inline — we don't import createClip to keep this module decoupled from timeline.ts.
      // Instead we call addClip with a minimal clip object.
      const newClip = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const atTime = cmd.atTime ?? s.playhead ?? 0;
      const duration = cmd.duration ?? 3;
      const positionToTransform = (pos: typeof cmd.position) => {
        const t = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };
        if (pos === 'top') t.y = -200;
        else if (pos === 'bottom') t.y = 200;
        else if (pos === 'top-left') { t.x = -300; t.y = -200; }
        else if (pos === 'top-right') { t.x = 300; t.y = -200; }
        else if (pos === 'bottom-left') { t.x = -300; t.y = 200; }
        else if (pos === 'bottom-right') { t.x = 300; t.y = 200; }
        return t;
      };
      s.addClip({
        id: newClip,
        trackId: textTrack!.id,
        kind: 'text',
        sourceStart: 0,
        sourceEnd: duration,
        timelineStart: atTime,
        duration,
        speed: 1,
        reverse: false,
        frozen: null,
        transform: positionToTransform(cmd.position),
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        blendMode: 'normal',
        color: {
          exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0,
          whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0,
        },
        audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: true },
        effects: [],
        filters: [],
        transitions: [],
        keyframes: [],
        masks: [],
        enabled: true,
        text: {
          text: cmd.text,
          fontFamily: 'Inter, sans-serif',
          fontSize: 48,
          fontWeight: 600,
          italic: false,
          letterSpacing: 0,
          lineHeight: 1.2,
          align: 'center',
          color: '#ffffff',
        },
        label: 'Text',
      });
      return 'applied';
    }

    case 'remove_text': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === cmd.clipId);
      if (!clip || clip.kind !== 'text') return 'skipped';
      s.selectClips([cmd.clipId]);
      s.deleteSelected();
      return 'applied';
    }

    case 'add_caption': {
      // Markers can't add captions directly — captions are generated by the transcription pipeline.
      // Emit a marker to indicate where captions should be added.
      s.addMarker(s.playhead ?? 0, 'Captions pending');
      return 'applied';
    }

    case 'remove_silence': {
      // Mark silence removal — actual processing happens via the worker pipeline.
      s.addMarker(s.playhead ?? 0, 'Remove silence (pending)');
      return 'applied';
    }

    case 'apply_filter': {
      const clipId = cmd.clipId ?? s.selectedClipIds[0];
      if (!clipId || !existingClipIds.has(clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return 'skipped';
      const newFilters = [
        ...clip.filters.filter((f) => f.type !== cmd.filter),
        { id: `flt_${Date.now()}`, type: cmd.filter, intensity: cmd.intensity ?? 0.7, enabled: true },
      ];
      s.updateClipSilent(clipId, { filters: newFilters });
      return 'applied';
    }

    case 'adjust_color': {
      const clipId = cmd.clipId ?? s.selectedClipIds[0];
      if (!clipId || !existingClipIds.has(clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return 'skipped';
      const merged = { ...clip.color, ...stripUndefined(cmd) };
      s.updateClipSilent(clipId, { color: merged });
      return 'applied';
    }

    case 'add_transition': {
      const clipId = cmd.clipId ?? s.selectedClipIds[0];
      if (!clipId || !existingClipIds.has(clipId)) return 'skipped';
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return 'skipped';
      const newTransitions = [
        ...clip.transitions,
        { id: `trn_${Date.now()}`, type: cmd.transitionType, duration: cmd.duration },
      ];
      s.updateClipSilent(clipId, { transitions: newTransitions });
      return 'applied';
    }

    case 'add_marker': {
      s.addMarker(cmd.time, cmd.label);
      return 'applied';
    }

    case 'duplicate_clip': {
      if (!existingClipIds.has(cmd.clipId)) return 'skipped';
      s.selectClips([cmd.clipId]);
      s.duplicateSelected();
      return 'applied';
    }

    case 'create_short':
    case 'reframe': {
      // These produce derivative clips requiring a worker pipeline (reframe / short extraction).
      // Mark in the timeline; the actual processing happens via the worker.
      s.addMarker(s.playhead ?? 0, `${cmd.type} (pending worker pipeline)`);
      return 'applied';
    }

    default: {
      return 'skipped';
    }
  }
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
