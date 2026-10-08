'use client';

// VidiaForge — Editor store
// Holds the active project, timeline state, playback, selection, and command history
// for undo/redo. All mutations are non-destructive and reversible.

import { create } from 'zustand';
import type {
  ProjectMeta,
  TimelineTrack,
  TimelineClip,
  TimelineMarker,
  TimelineState,
  AssetRef,
  MediaAssetDTO,
  RenderJobDTO,
} from '@/lib/types';
import {
  emptyTimelineState,
  uid,
  createClip as createClipFn,
  createTrack as createTrackFn,
  computeDuration,
} from '@/lib/timeline';

type Tool = 'select' | 'blade' | 'hand' | 'zoom';

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'offline' | 'syncing' | 'error';
  lastSavedAt: number | null;
}

interface HistoryEntry {
  label: string;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  inPoint?: number;
  outPoint?: number;
}

// V19: export EditorState so the AI command-engine executor (and other
// external modules) can reference its shape without circular imports.
export interface EditorState {
  // Project
  projectId: string | null;
  project: ProjectMeta | null;
  loading: boolean;

  // Timeline data
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  inPoint?: number;
  outPoint?: number;
  assets: AssetRef[]; // project-scoped asset refs

  // Playback
  playhead: number; // seconds
  playing: boolean;
  playbackSpeed: number;
  duration: number; // computed
  zoom: number; // px per second
  scrollX: number;

  // Selection & tools
  selectedClipIds: string[];
  selectedTrackId: string | null;
  tool: Tool;
  snap: boolean;
  magnetic: boolean;
  snappingTargets: 'edges' | 'all';

  // History
  past: HistoryEntry[];
  future: HistoryEntry[];
  historyLabel: string;

  // Save
  save: SaveState;

  // Media upload
  uploadingCount: number;

  // Render jobs
  renderJobs: RenderJobDTO[];

  // === Actions ===
  loadProject: (projectId: string) => Promise<void>;
  reset: () => void;

  // Playback
  setPlayhead: (t: number) => void;
  seekTo: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setPlaying: (p: boolean) => void;
  stepFrame: (dir: 1 | -1, fps: number) => void;
  setPlaybackSpeed: (s: number) => void;
  setZoom: (z: number) => void;
  setScrollX: (x: number) => void;

  // Selection & tools
  selectClip: (id: string | null, additive?: boolean) => void;
  selectClips: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setSnap: (s: boolean) => void;
  setMagnetic: (m: boolean) => void;

  // Track ops
  addTrack: (kind: TimelineTrack['kind']) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, patch: Partial<TimelineTrack>) => void;
  reorderTracks: (fromId: string, toId: string) => void;

  // Clip ops
  addClip: (clip: TimelineClip) => void;
  addMediaToTimeline: (asset: MediaAssetDTO, trackId: string, at: number) => string;
  updateClip: (clipId: string, patch: Partial<TimelineClip>, label?: string) => void;
  updateClipSilent: (clipId: string, patch: Partial<TimelineClip>) => void;
  moveClip: (clipId: string, timelineStart: number, trackId?: string) => void;
  trimClip: (clipId: string, side: 'start' | 'end', deltaSec: number) => void;
  splitClip: (clipId: string, atTimelineTime: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;

  // Markers
  addMarker: (time: number, label?: string) => void;
  removeMarker: (id: string) => void;

  // In/out
  setInPoint: (t?: number) => void;
  setOutPoint: (t?: number) => void;

  // History
  pushHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;

  // Save
  setSaveStatus: (s: SaveState['status']) => void;
  scheduleSave: () => void;

  // Upload
  setUploadingCount: (n: number) => void;
  addAsset: (asset: AssetRef) => void;
  refreshAssets: () => Promise<void>;
  refreshRenderJobs: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  project: null,
  loading: false,

  tracks: emptyTimelineState().tracks,
  clips: [],
  markers: [],
  assets: [],

  playhead: 0,
  playing: false,
  playbackSpeed: 1,
  duration: 0,
  zoom: 80, // px per second baseline
  scrollX: 0,

  selectedClipIds: [],
  selectedTrackId: null,
  tool: 'select',
  snap: true,
  magnetic: true,
  snappingTargets: 'all',

  past: [],
  future: [],
  historyLabel: 'Initial state',

  save: { status: 'idle', lastSavedAt: null },
  uploadingCount: 0,
  renderJobs: [],

  loadProject: async (projectId) => {
    set({ loading: true, projectId });
    try {
      const res = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      const ts: TimelineState = data.timeline
        ? JSON.parse(data.timeline)
        : emptyTimelineState();
      set({
        project: {
          id: data.id,
          name: data.name,
          width: data.width,
          height: data.height,
          fps: data.fps,
          canvasPreset: data.canvasPreset,
          resolution: data.resolution,
          duration: data.duration ?? 0,
          thumbnailUrl: data.thumbnailUrl ?? undefined,
          favorite: data.favorite ?? false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          lastOpenedAt: data.lastOpenedAt,
        },
        tracks: ts.tracks ?? [],
        clips: ts.clips ?? [],
        markers: ts.markers ?? [],
        inPoint: ts.inPoint,
        outPoint: ts.outPoint,
        duration: computeDuration(ts.clips ?? []),
        past: [],
        future: [],
        historyLabel: 'Loaded',
        loading: false,
      });
      // Load assets + render jobs in parallel
      get().refreshAssets();
      get().refreshRenderJobs();
    } catch (e) {
      console.error('loadProject error', e);
      set({ loading: false });
    }
  },

  reset: () => {
    set({
      projectId: null,
      project: null,
      tracks: emptyTimelineState().tracks,
      clips: [],
      markers: [],
      assets: [],
      playhead: 0,
      playing: false,
      duration: 0,
      selectedClipIds: [],
      past: [],
      future: [],
    });
  },

  setPlayhead: (t) => set((s) => ({ playhead: Math.max(0, t), duration: s.duration })),
  seekTo: (t) => set({ playhead: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (p) => set({ playing: p }),
  stepFrame: (dir, fps) =>
    set((s) => ({ playhead: Math.max(0, s.playhead + (dir * 1) / fps) })),
  setPlaybackSpeed: (s) => set({ playbackSpeed: s }),
  setZoom: (z) => set({ zoom: Math.max(8, Math.min(400, z)) }),
  setScrollX: (x) => set({ scrollX: Math.max(0, x) }),

  selectClip: (id, additive) =>
    set((s) => {
      if (id === null) return { selectedClipIds: [], selectedTrackId: null };
      if (additive) {
        return s.selectedClipIds.includes(id)
          ? { selectedClipIds: s.selectedClipIds.filter((c) => c !== id) }
          : { selectedClipIds: [...s.selectedClipIds, id] };
      }
      return { selectedClipIds: [id] };
    }),
  selectClips: (ids) => set({ selectedClipIds: ids }),
  setTool: (t) => set({ tool: t }),
  setSnap: (s) => set({ snap: s }),
  setMagnetic: (m) => set({ magnetic: m }),

  addTrack: (kind) => {
    get().pushHistory('Add track');
    const track = createTrackFn(kind);
    set((s) => ({ tracks: [...s.tracks, track] }));
    get().scheduleSave();
  },

  removeTrack: (trackId) => {
    get().pushHistory('Remove track');
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== trackId),
      clips: s.clips.filter((c) => c.trackId !== trackId),
    }));
    get().scheduleSave();
  },

  updateTrack: (trackId, patch) => {
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    }));
    get().scheduleSave();
  },

  reorderTracks: (fromId, toId) => {
    get().pushHistory('Reorder tracks');
    set((s) => {
      const tracks = [...s.tracks];
      const fromIdx = tracks.findIndex((t) => t.id === fromId);
      const toIdx = tracks.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return {};
      const [moved] = tracks.splice(fromIdx, 1);
      tracks.splice(toIdx, 0, moved);
      return { tracks };
    });
    get().scheduleSave();
  },

  addClip: (clip) => {
    get().pushHistory('Add clip');
    set((s) => ({
      clips: [...s.clips, clip],
      selectedClipIds: [clip.id],
      selectedTrackId: clip.trackId,
      duration: computeDuration([...s.clips, clip]),
    }));
    get().scheduleSave();
  },

  addMediaToTimeline: (asset, trackId, at) => {
    get().pushHistory(`Add ${asset.kind}`);
    const dur = asset.duration ?? 5;
    const kind =
      asset.kind === 'video' ? 'video' :
      asset.kind === 'audio' ? 'audio' :
      asset.kind === 'image' ? 'image' : 'video';
    const clip = createClipFn({
      trackId,
      kind,
      assetId: asset.id,
      assetName: asset.filename,
      sourceStart: 0,
      sourceEnd: dur,
      timelineStart: Math.max(0, at),
      duration: dur,
      label: asset.filename,
      thumbnailUrl: asset.thumbnailUrl,
      waveformUrl: asset.waveformUrl,
    });
    set((s) => ({
      clips: [...s.clips, clip],
      selectedClipIds: [clip.id],
      selectedTrackId: trackId,
      duration: computeDuration([...s.clips, clip]),
    }));
    get().scheduleSave();
    return clip.id;
  },

  updateClip: (clipId, patch, label) => {
    if (label) get().pushHistory(label);
    set((s) => ({
      clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      duration: computeDuration(s.clips),
    }));
    get().scheduleSave();
  },

  updateClipSilent: (clipId, patch) => {
    set((s) => ({
      clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }));
  },

  moveClip: (clipId, timelineStart, trackId) => {
    get().pushHistory('Move clip');
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === clipId
          ? { ...c, timelineStart: Math.max(0, timelineStart), trackId: trackId ?? c.trackId }
          : c
      ),
    }));
    get().scheduleSave();
  },

  trimClip: (clipId, side, deltaSec) => {
    get().pushHistory('Trim clip');
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== clipId) return c;
        if (side === 'start') {
          const newStart = Math.max(0, c.timelineStart + deltaSec);
          const newDuration = Math.max(0.1, c.duration - deltaSec);
          const newSourceStart = Math.max(0, c.sourceStart + deltaSec);
          return { ...c, timelineStart: newStart, duration: newDuration, sourceStart: newSourceStart };
        } else {
          const newDuration = Math.max(0.1, c.duration + deltaSec);
          const newSourceEnd = c.sourceStart + newDuration * c.speed;
          return { ...c, duration: newDuration, sourceEnd: newSourceEnd };
        }
      }),
      duration: computeDuration(s.clips),
    }));
    get().scheduleSave();
  },

  splitClip: (clipId, atTimelineTime) => {
    get().pushHistory('Split clip');
    set((s) => {
      const clip = s.clips.find((c) => c.id === clipId);
      if (!clip) return {};
      const offset = atTimelineTime - clip.timelineStart;
      if (offset <= 0.05 || offset >= clip.duration - 0.05) return {};
      const leftDur = offset;
      const rightDur = clip.duration - offset;
      const left: TimelineClip = {
        ...clip,
        id: uid('clip'),
        duration: leftDur,
        sourceEnd: clip.sourceStart + leftDur * clip.speed,
      };
      const right: TimelineClip = {
        ...clip,
        id: uid('clip'),
        timelineStart: clip.timelineStart + leftDur,
        duration: rightDur,
        sourceStart: clip.sourceStart + leftDur * clip.speed,
        sourceEnd: clip.sourceStart + clip.duration * clip.speed,
      };
      return {
        clips: [...s.clips.filter((c) => c.id !== clipId), left, right],
        selectedClipIds: [right.id],
      };
    });
    get().scheduleSave();
  },

  splitAtPlayhead: () => {
    const { playhead, selectedClipIds, clips } = get();
    // Find clip under playhead (prefer selected)
    let target = clips.find((c) => selectedClipIds.includes(c.id) && playhead > c.timelineStart + 0.05 && playhead < c.timelineStart + c.duration - 0.05);
    if (!target) {
      target = clips.find((c) => playhead > c.timelineStart + 0.05 && playhead < c.timelineStart + c.duration - 0.05);
    }
    if (target) get().splitClip(target.id, playhead);
  },

  deleteSelected: () => {
    const { selectedClipIds } = get();
    if (selectedClipIds.length === 0) return;
    get().pushHistory('Delete clip');
    set((s) => ({
      clips: s.clips.filter((c) => !selectedClipIds.includes(c.id)),
      selectedClipIds: [],
      duration: computeDuration(s.clips.filter((c) => !selectedClipIds.includes(c.id))),
    }));
    get().scheduleSave();
  },

  duplicateSelected: () => {
    const { selectedClipIds, clips } = get();
    if (selectedClipIds.length === 0) return;
    get().pushHistory('Duplicate clip');
    const toDup = clips.filter((c) => selectedClipIds.includes(c.id));
    const newClips = toDup.map((c) => ({
      ...c,
      id: uid('clip'),
      timelineStart: c.timelineStart + c.duration,
    }));
    set((s) => ({
      clips: [...s.clips, ...newClips],
      selectedClipIds: newClips.map((c) => c.id),
      duration: computeDuration([...s.clips, ...newClips]),
    }));
    get().scheduleSave();
  },

  addMarker: (time, label) => {
    get().pushHistory('Add marker');
    const marker: TimelineMarker = {
      id: uid('mrk'),
      time,
      label: label ?? 'Marker',
      color: '#f5a623',
    };
    set((s) => ({ markers: [...s.markers, marker] }));
    get().scheduleSave();
  },

  removeMarker: (id) => {
    get().pushHistory('Remove marker');
    set((s) => ({ markers: s.markers.filter((m) => m.id !== id) }));
    get().scheduleSave();
  },

  setInPoint: (t) => set({ inPoint: t }),
  setOutPoint: (t) => set({ outPoint: t }),

  pushHistory: (label) => {
    const { tracks, clips, markers, inPoint, outPoint, past } = get();
    const entry: HistoryEntry = { label, tracks: [...tracks], clips: clips.map((c) => ({ ...c })), markers: [...markers], inPoint, outPoint };
    const newPast = [...past, entry].slice(-100); // cap history at 100
    set({ past: newPast, future: [], historyLabel: label });
  },

  undo: () => {
    const { past, future, tracks, clips, markers, inPoint, outPoint } = get();
    if (past.length === 0) return;
    const present: HistoryEntry = { label: get().historyLabel, tracks: [...tracks], clips: clips.map((c) => ({ ...c })), markers: [...markers], inPoint, outPoint };
    const newFuture = [present, ...future].slice(0, 100);
    const prev = past[past.length - 1];
    const newPast = past.slice(0, -1);
    set({
      tracks: [...prev.tracks],
      clips: prev.clips.map((c) => ({ ...c })),
      markers: [...prev.markers],
      inPoint: prev.inPoint,
      outPoint: prev.outPoint,
      past: newPast,
      future: newFuture,
      historyLabel: prev.label,
      duration: computeDuration(prev.clips),
    });
    get().scheduleSave();
  },

  redo: () => {
    const { past, future, tracks, clips, markers, inPoint, outPoint } = get();
    if (future.length === 0) return;
    const present: HistoryEntry = { label: get().historyLabel, tracks: [...tracks], clips: clips.map((c) => ({ ...c })), markers: [...markers], inPoint, outPoint };
    const newPast = [...past, present].slice(-100);
    const next = future[0];
    const newFuture = future.slice(1);
    set({
      tracks: [...next.tracks],
      clips: next.clips.map((c) => ({ ...c })),
      markers: [...next.markers],
      inPoint: next.inPoint,
      outPoint: next.outPoint,
      past: newPast,
      future: newFuture,
      historyLabel: next.label,
      duration: computeDuration(next.clips),
    });
    get().scheduleSave();
  },

  setSaveStatus: (status) =>
    set((s) => ({ save: { status, lastSavedAt: status === 'saved' ? Date.now() : s.save.lastSavedAt } })),

  scheduleSave: () => {
    set({ save: { status: 'saving', lastSavedAt: get().save.lastSavedAt } });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await persistProject();
    }, 1200);
  },

  setUploadingCount: (n) => set({ uploadingCount: n }),
  addAsset: (asset) => set((s) => ({ assets: [asset, ...s.assets] })),

  refreshAssets: async () => {
    const pid = get().projectId;
    if (!pid) return;
    try {
      const res = await fetch(`/api/assets?projectId=${pid}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const assets: AssetRef[] = (data.assets ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: a.filename as string,
          kind: a.kind as 'video' | 'audio' | 'image',
          mimeType: a.mimeType as string,
          size: a.size as number,
          duration: a.duration as number | undefined,
          width: a.width as number | undefined,
          height: a.height as number | undefined,
          fps: a.fps as number | undefined,
          thumbnailUrl: a.thumbnailUrl as string | undefined,
          waveformUrl: a.waveformUrl as string | undefined,
          storagePath: a.storagePath as string,
          status: (a.status as 'uploading' | 'processing' | 'ready' | 'failed') || 'ready',
          errorMessage: a.errorMessage as string | undefined,
        }));
        set({ assets });
      }
    } catch {
      // ignore
    }
  },

  refreshRenderJobs: async () => {
    const pid = get().projectId;
    if (!pid) return;
    try {
      const res = await fetch(`/api/render?projectId=${pid}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        set({ renderJobs: data.jobs ?? [] });
      }
    } catch {
      // ignore
    }
  },
}));

async function persistProject() {
  const store = useEditorStore.getState();
  const pid = store.projectId;
  if (!pid) return;
  store.setSaveStatus('syncing');

  const timelineState: TimelineState = {
    schemaVersion: 1,
    tracks: store.tracks,
    clips: store.clips,
    markers: store.markers,
    inPoint: store.inPoint,
    outPoint: store.outPoint,
  };
  const timelineJSON = JSON.stringify(timelineState);

  // Save local snapshot first (always succeeds — for crash recovery)
  try {
    const { saveProjectSnapshot, pruneOldSnapshots } = await import('@/lib/offline/indexeddb');
    await saveProjectSnapshot({
      id: `${pid}_${Date.now()}`,
      projectId: pid,
      name: store.project?.name ?? 'Untitled',
      data: timelineJSON,
      duration: store.duration,
      savedAt: Date.now(),
    });
    // Keep only the latest 10 snapshots
    pruneOldSnapshots(pid, 10).catch(() => {});
  } catch {
    // IndexedDB not available — continue with cloud save only
  }

  // Cloud save
  try {
    const res = await fetch(`/api/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: store.project?.name,
        timelineData: timelineJSON,
        duration: store.duration,
      }),
    });
    if (res.ok) {
      store.setSaveStatus('saved');
    } else {
      store.setSaveStatus('error');
    }
  } catch {
    // Network failed — we still have the local snapshot
    store.setSaveStatus('offline');
  }
}
