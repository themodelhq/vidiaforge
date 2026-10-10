'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Plus, ZoomIn, ZoomOut, Magnet, Lock, LockOpen, Eye, EyeOff,
  Volume2, VolumeX, Headphones, Trash2, ChevronDown, ChevronUp, Layers,
  Scissors, MousePointer2, Hand, Maximize as ZoomIcon, Flag, Music2, Type, Film,
  ArrowLeftRight, ArrowRightLeft, ArrowUpNarrowWide, ArrowDownNarrowWide,
  Eraser, Import, CornerDownRight,
} from 'lucide-react';
import { formatTimecode, snap, createTrack, createClip } from '@/lib/timeline';
import type { TimelineClip, TimelineTrack, TrackKind } from '@/lib/types';

const MIN_CLIP_WIDTH_PX = 8;

export function BottomTimeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const clips = useEditorStore((s) => s.clips);
  const markers = useEditorStore((s) => s.markers);
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => s.duration);
  const zoom = useEditorStore((s) => s.zoom);
  const scrollX = useEditorStore((s) => s.scrollX);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setScrollX = useEditorStore((s) => s.setScrollX);
  const seekTo = useEditorStore((s) => s.seekTo);
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const selectClip = useEditorStore((s) => s.selectClip);
  const snapEnabled = useUIStore((s) => s.snap);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const timecodeFormat = useUIStore((s) => s.timecodeFormat);
  const project = useEditorStore((s) => s.project);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const updateClip = useEditorStore((s) => s.updateClip);
  const moveClip = useEditorStore((s) => s.moveClip);
  const trimClip = useEditorStore((s) => s.trimClip);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const addMarker = useEditorStore((s) => s.addMarker);
  const removeMarker = useEditorStore((s) => s.removeMarker);

  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const [timelineHeight, setTimelineHeight] = useState(280);
  const [drag, setDrag] = useState<null | {
    type: 'move' | 'trim-start' | 'trim-end' | 'seek' | 'marquee';
    clipId?: string;
    startX: number;
    startVal: number;
    origClip?: TimelineClip;
  }>(null);

  const fps = project?.fps ?? 30;
  const pxPerSec = zoom;
  const totalDuration = Math.max(duration, 10);
  const contentWidth = totalDuration * pxPerSec + 100;

  const timeToX = useCallback((t: number) => t * pxPerSec - scrollX, [pxPerSec, scrollX]);
  const xToTime = useCallback((x: number) => (x + scrollX) / pxPerSec, [pxPerSec, scrollX]);

  // Sync ruler + tracks horizontal scroll
  const onTracksScroll = useCallback(() => {
    if (tracksScrollRef.current) {
      setScrollX(tracksScrollRef.current.scrollLeft);
    }
  }, [setScrollX]);

  // Click on ruler to seek
  const onRulerMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const t = Math.max(0, xToTime(x));
    seekTo(t);
    setDrag({ type: 'seek', startX: e.clientX, startVal: t });
  }, [xToTime, seekTo]);

  // Global mouse move/up for drag
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startX;
      const dt = dx / pxPerSec;
      if (drag.type === 'seek') {
        const t = Math.max(0, drag.startVal + dt);
        seekTo(t);
      } else if (drag.type === 'move' && drag.clipId && drag.origClip) {
        let newStart = Math.max(0, drag.origClip.timelineStart + dt);
        if (snapEnabled) {
          const targets = [
            0,
            ...clips.filter((c) => c.id !== drag.clipId).map((c) => c.timelineStart),
            ...clips.filter((c) => c.id !== drag.clipId).map((c) => c.timelineStart + c.duration),
            playhead,
          ];
          const snapped = snap(newStart, targets, 8 / pxPerSec);
          newStart = snapped.value;
        }
        moveClip(drag.clipId, newStart, drag.origClip.trackId);
      } else if (drag.type === 'trim-start' && drag.clipId && drag.origClip) {
        const delta = dt;
        trimClip(drag.clipId, 'start', delta);
        drag.startX = e.clientX; // incremental trim
        drag.origClip = useEditorStore.getState().clips.find((c) => c.id === drag.clipId);
      } else if (drag.type === 'trim-end' && drag.clipId && drag.origClip) {
        const delta = dt;
        trimClip(drag.clipId, 'end', delta);
        drag.startX = e.clientX;
        drag.origClip = useEditorStore.getState().clips.find((c) => c.id === drag.clipId);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, pxPerSec, clips, playhead, snapEnabled, seekTo, moveClip, trimClip]);

  const onClipMouseDown = useCallback((e: React.MouseEvent, clip: TimelineClip, mode: 'move' | 'trim-start' | 'trim-end') => {
    e.stopPropagation();
    if (tool === 'blade') {
      // Split at click position
      const trackEl = e.currentTarget.closest('[data-track-id]') as HTMLElement;
      const rect = trackEl?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const t = xToTime(x);
        const localT = t;
        useEditorStore.getState().splitClip(clip.id, localT);
      }
      return;
    }
    selectClip(clip.id, e.shiftKey);
    setDrag({ type: mode, clipId: clip.id, startX: e.clientX, startVal: clip.timelineStart, origClip: { ...clip } });
  }, [tool, selectClip, xToTime]);

  // Ruler tick marks
  const ticks = useMemo(() => {
    const step = zoom < 30 ? 5 : zoom < 60 ? 2 : zoom < 120 ? 1 : 0.5;
    const arr: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= totalDuration + step; t += step) {
      arr.push({ t, major: t % (step * 5) < 0.01 });
    }
    return arr;
  }, [zoom, totalDuration]);

  const tools: { id: 'select' | 'blade' | 'hand' | 'zoom'; icon: React.ElementType; label: string; key?: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
    { id: 'blade', icon: Scissors, label: 'Blade', key: 'B' },
    { id: 'hand', icon: Hand, label: 'Hand', key: 'H' },
    { id: 'zoom', icon: ZoomIcon, label: 'Zoom', key: 'Z' },
  ];

  return (
    <div className="flex flex-col border-t border-border/60 bg-editor-panel" style={{ height: timelineHeight }}>
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        {/* Tools */}
        <div className="flex items-center gap-0.5 rounded-md bg-background/40 p-0.5">
          {tools.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setTool(t.id)}
                    className={`flex h-7 w-7 items-center justify-center rounded transition ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                    aria-label={t.label}
                    aria-pressed={active}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t.label}{t.key && <kbd className="ml-1 text-[10px] opacity-70">{t.key}</kbd>}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="w-px h-4 bg-border/60 mx-1" />

        {/* Split + marker */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={splitAtPlayhead}>
              <Scissors className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Split at playhead <kbd className="ml-1 text-[10px] opacity-70">S</kbd></TooltipContent>
        </Tooltip>

        {/* V19.1: Professional Trim Tools */}
        <div className="w-px h-4 bg-border/60 mx-1" />
        <TrimTools clips={clips} tracks={tracks} selectedClipIds={selectedClipIds} updateClip={updateClip} pushHistory={useEditorStore.getState().pushHistory} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => addMarker(playhead)}>
              <Flag className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Add marker at playhead</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border/60 mx-1" />

        {/* Snap */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${snapEnabled ? 'text-primary' : ''}`} onClick={toggleSnap}>
              <Magnet className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Snapping {snapEnabled ? 'on' : 'off'}</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Timecode */}
        <div className="font-mono text-[11px] text-muted-foreground tabular-nums hidden sm:block mr-1">
          {formatTimecode(playhead, fps, timecodeFormat)} <span className="text-muted-foreground/60">/</span> {formatTimecode(duration, fps, timecodeFormat)}
        </div>

        <div className="w-px h-4 bg-border/60 mx-1" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoom * 0.7)}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <input
            type="range"
            min={8}
            max={400}
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            className="vf-range w-24"
            aria-label="Timeline zoom"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoom * 1.4)}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="w-px h-4 bg-border/60 mx-1" />

        {/* Collapse/expand height */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setTimelineHeight((h) => (h < 200 ? 280 : h >= 280 ? 420 : 280))}
            >
              {timelineHeight < 280 ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle timeline height</TooltipContent>
        </Tooltip>
      </div>

      {/* Ruler + tracks */}
      <div className="flex flex-1 min-h-0">
        {/* Track headers */}
        <div className="w-44 shrink-0 border-r border-border/40 bg-editor-panel-elevated flex flex-col">
          {/* Ruler header spacer */}
          <div className="h-7 border-b border-border/40 flex items-center px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Tracks
          </div>
          {/* Track header rows */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {tracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
            <button
              onClick={() => addTrack('video')}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition border-b border-border/30"
            >
              <Plus className="h-3 w-3" /> Add track
            </button>
          </div>
        </div>

        {/* Timeline scroll area */}
        <div
          ref={tracksScrollRef}
          onScroll={onTracksScroll}
          className="relative flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin"
          style={{ cursor: tool === 'hand' ? 'grab' : 'default' }}
        >
          <div style={{ width: contentWidth, minWidth: '100%' }} className="relative">
            {/* Ruler */}
            <div
              ref={rulerRef}
              onMouseDown={onRulerMouseDown}
              className="sticky top-0 z-20 h-7 border-b border-border/40 bg-timeline-ruler cursor-text"
              style={{ width: contentWidth }}
            >
              {ticks.map((tick, i) => {
                const x = timeToX(tick.t);
                if (x < -50 || x > contentWidth) return null;
                return (
                  <div key={i} className="absolute top-0 h-full" style={{ left: x }}>
                    <div className={`w-px ${tick.major ? 'h-3 bg-border' : 'h-2 bg-border/50'}`} />
                    {tick.major && (
                      <span className="absolute top-3 left-1 text-[9px] font-mono text-muted-foreground whitespace-nowrap">
                        {formatTimecode(tick.t, fps, 'seconds')}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Markers on ruler */}
              {markers.map((m) => {
                const x = timeToX(m.time);
                if (x < -20 || x > contentWidth) return null;
                return (
                  <Tooltip key={m.id}>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary/60 cursor-pointer group"
                      style={{ left: x }}
                      onClick={(e) => { e.stopPropagation(); seekTo(m.time); }}
                    >
                      <Flag className="absolute -top-0.5 -left-1 h-3 w-3 text-primary fill-primary" />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMarker(m.id); }}
                        className="absolute -top-1 left-2 hidden group-hover:flex h-3 w-3 items-center justify-center text-destructive"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            {/* Tracks */}
            <div className="relative">
              {tracks.map((track) => {
                const trackClips = clips.filter((c) => c.trackId === track.id);
                return (
                  <div
                    key={track.id}
                    data-track-id={track.id}
                    className="relative border-b border-border/30 bg-timeline-track/40"
                    style={{ height: track.height, opacity: track.hidden ? 0.4 : 1 }}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) selectClip(null);
                    }}
                  >
                    {/* Track background grid */}
                    {ticks.filter((t) => t.major).map((tick, i) => {
                      const x = timeToX(tick.t);
                      return <div key={i} className="absolute top-0 bottom-0 w-px bg-border/20" style={{ left: x }} />;
                    })}
                    {/* Clips */}
                    {trackClips.map((clip) => (
                      <TimelineClipView
                        key={clip.id}
                        clip={clip}
                        track={track}
                        selected={selectedClipIds.includes(clip.id)}
                        timeToX={timeToX}
                        pxPerSec={pxPerSec}
                        tool={tool}
                        onMouseDown={(e, mode) => onClipMouseDown(e, clip, mode)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-30"
              style={{ left: timeToX(playhead) }}
            >
              <div className="absolute top-0 -left-1.5 h-3 w-3 bg-primary rotate-45 rounded-sm" />
              <div className="absolute top-3 bottom-0 w-px bg-primary" />
            </div>

            {/* In/out region overlay */}
            {useEditorStore.getState().inPoint !== undefined && useEditorStore.getState().outPoint !== undefined && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 bg-primary/10 border-x border-primary/40"
                style={{
                  left: timeToX(useEditorStore.getState().inPoint!),
                  width: (useEditorStore.getState().outPoint! - useEditorStore.getState().inPoint!) * pxPerSec,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHeader({ track }: { track: TimelineTrack }) {
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const Icon = track.kind === 'video' ? Film : track.kind === 'audio' ? Music2 : track.kind === 'text' ? Type : Layers;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/30 h-12" style={{ height: track.height }}>
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <input
        value={track.name}
        onChange={(e) => updateTrack(track.id, { name: e.target.value })}
        className="bg-transparent text-[11px] font-medium min-w-0 flex-1 outline-none focus:bg-background/60 rounded px-1 py-0.5"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
          className={`h-5 w-5 flex items-center justify-center rounded ${track.muted ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
          title={track.muted ? 'Unmute' : 'Mute'}
        >
          {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
        </button>
        <button
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
          className={`h-5 w-5 flex items-center justify-center rounded ${track.solo ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title="Solo"
        >
          <Headphones className="h-3 w-3" />
        </button>
        <button
          onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
          className={`h-5 w-5 flex items-center justify-center rounded ${track.hidden ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
          title={track.hidden ? 'Show' : 'Hide'}
        >
          {track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          onClick={() => updateTrack(track.id, { locked: !track.locked })}
          className={`h-5 w-5 flex items-center justify-center rounded ${track.locked ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
          title={track.locked ? 'Unlock' : 'Lock'}
        >
          {track.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

function TimelineClipView({ clip, track, selected, timeToX, pxPerSec, tool, onMouseDown }: {
  clip: TimelineClip;
  track: TimelineTrack;
  selected: boolean;
  timeToX: (t: number) => number;
  pxPerSec: number;
  tool: string;
  onMouseDown: (e: React.MouseEvent, mode: 'move' | 'trim-start' | 'trim-end') => void;
}) {
  const left = timeToX(clip.timelineStart);
  const width = Math.max(MIN_CLIP_WIDTH_PX, clip.duration * pxPerSec);

  const bgClass = clip.kind === 'video' ? 'bg-amber-600/40 border-amber-500/60'
    : clip.kind === 'audio' ? 'bg-emerald-600/40 border-emerald-500/60'
    : clip.kind === 'image' ? 'bg-violet-600/40 border-violet-500/60'
    : clip.kind === 'text' ? 'bg-fuchsia-600/40 border-fuchsia-500/60'
    : 'bg-sky-600/40 border-sky-500/60';

  const labelIcon = clip.kind === 'video' ? '▶' : clip.kind === 'audio' ? '♪' : clip.kind === 'text' ? 'T' : clip.kind === 'image' ? '◆' : '◇';

  return (
    <div
      onMouseDown={(e) => !track.locked && onMouseDown(e, 'move')}
      className={`absolute top-1 bottom-1 rounded border ${bgClass} ${selected ? 'ring-2 ring-primary' : ''} ${track.locked ? 'cursor-not-allowed opacity-60' : tool === 'blade' ? 'cursor-text' : 'cursor-grab'} overflow-hidden group`}
      style={{ left, width, cursor: tool === 'hand' ? 'grab' : undefined }}
    >
      {/* Thumbnail strip for video/image */}
      {(clip.kind === 'video' || clip.kind === 'image') && clip.thumbnailUrl && (
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `url(${clip.thumbnailUrl})`,
          backgroundSize: 'auto 100%',
          backgroundRepeat: 'repeat-x',
        }} />
      )}

      {/* Waveform for audio */}
      {clip.kind === 'audio' && (
        <WaveformStrip width={width} height={track.height - 8} />
      )}

      {/* Trim handles */}
      {!track.locked && (
        <>
          <div
            onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'trim-start'); }}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30"
          />
          <div
            onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'trim-end'); }}
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30"
          />
        </>
      )}

      {/* Label */}
      <div className="absolute inset-0 px-2 py-1 flex items-center gap-1 overflow-hidden">
        <span className="text-[10px] opacity-80">{labelIcon}</span>
        <span className="text-[10px] text-white/90 truncate font-medium">{clip.label || clip.kind}</span>
      </div>

      {/* Speed badge */}
      {clip.speed !== 1 && (
        <div className="absolute top-0.5 right-1.5 text-[9px] font-mono text-white/80 bg-black/40 px-1 rounded">
          {clip.speed}×
        </div>
      )}
      {/* Locked badge */}
      {track.locked && <Lock className="absolute top-1 right-1 h-2.5 w-2.5 text-white/70" />}
    </div>
  );
}

function WaveformStrip({ width, height }: { width: number; height: number }) {
  // Deterministic pseudo-waveform
  const bars = Math.max(8, Math.floor(width / 3));
  const peaks = useMemo(() => {
    const arr: number[] = [];
    let seed = 12345;
    for (let i = 0; i < bars; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      arr.push(0.2 + (seed / 233280) * 0.8);
    }
    return arr;
  }, [bars]);
  return (
    <div className="absolute inset-0 flex items-center gap-px px-1 opacity-50">
      {peaks.map((p, i) => (
        <div
          key={i}
          className="flex-1 bg-emerald-300/80 rounded-sm"
          style={{ height: `${p * height}px`, minHeight: 1 }}
        />
      ))}
    </div>
  );
}

// V19.1: Professional Trim Tools component
// Uses the EXISTING trim algorithms from src/lib/timeline/trim-operations.ts
import {
  rippleTrim, rollEdit, slipEdit, slideEdit, liftClip, extractClip,
} from '@/lib/timeline/trim-operations';

function TrimTools({
  clips, tracks, selectedClipIds, updateClip, pushHistory,
}: {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: string[];
  updateClip: (id: string, patch: Partial<TimelineClip>) => void;
  pushHistory: (label: string) => void;
}) {
  const selected = selectedClipIds[0];
  const clip = clips.find((c) => c.id === selected);
  if (!clip) return null;

  const ctx = { clips, tracks };
  const applyResult = (result: { clips: TimelineClip[]; description: string }) => {
    pushHistory('Trim: ' + result.description);
    // Update all affected clips
    result.clips.forEach((c) => {
      const existing = clips.find((old) => old.id === c.id);
      if (existing) {
        updateClip(c.id, c);
      }
    });
    // For new clips (from splits), add them — this requires a store action
    // that adds clips. For now, we only update existing clips.
  };

  const trimTools: { id: string; icon: typeof Scissors; label: string; action: () => void }[] = [
    {
      id: 'ripple',
      icon: CornerDownRight,
      label: 'Ripple',
      action: () => {
        const result = rippleTrim(ctx, clip.id, clip.duration * 0.8);
        applyResult(result);
      },
    },
    {
      id: 'extract',
      icon: Eraser,
      label: 'Extract',
      action: () => {
        const result = extractClip(ctx, clip.id);
        applyResult(result);
      },
    },
    {
      id: 'lift',
      icon: ArrowUpNarrowWide,
      label: 'Lift',
      action: () => {
        const result = liftClip(ctx, clip.id);
        applyResult(result);
      },
    },
    {
      id: 'slip',
      icon: ArrowLeftRight,
      label: 'Slip',
      action: () => {
        const result = slipEdit(ctx, clip.id, 0.5);
        applyResult(result);
      },
    },
    {
      id: 'slide',
      icon: ArrowRightLeft,
      label: 'Slide',
      action: () => {
        const result = slideEdit(ctx, clip.id, 0.5);
        applyResult(result);
      },
    },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-background/40 p-0.5">
      {trimTools.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger asChild>
            <button
              onClick={t.action}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              aria-label={t.label}
            >
              <t.icon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
