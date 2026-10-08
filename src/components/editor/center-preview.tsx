'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Maximize, Minimize, Scissors, Volume2, VolumeX, Settings2, Gauge, Magnet,
} from 'lucide-react';
import { formatTimecode, formatDuration } from '@/lib/timeline';

export function CenterPreview() {
  const project = useEditorStore((s) => s.project);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => s.duration);
  const playbackSpeed = useEditorStore((s) => s.playbackSpeed);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const seekTo = useEditorStore((s) => s.seekTo);
  const stepFrame = useEditorStore((s) => s.stepFrame);
  const setPlaybackSpeed = useEditorStore((s) => s.setPlaybackSpeed);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const timecodeFormat = useUIStore((s) => s.timecodeFormat);
  const snap = useUIStore((s) => s.snap);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const online = useUIStore((s) => s.online);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [muted, setMuted] = useState(false);
  const [previewQuality, setPreviewQuality] = useState<'full' | 'half' | 'proxy'>('full');
  const [showSettings, setShowSettings] = useState(false);

  const fps = project?.fps ?? 30;

  // Find visible clips at playhead (topmost video track wins)
  const visibleVideoClips = clips
    .filter((c) => {
      if (c.kind !== 'video' && c.kind !== 'image') return false;
      if (!c.enabled) return false;
      const track = tracks.find((t) => t.id === c.trackId);
      if (!track || track.hidden) return false;
      return playhead >= c.timelineStart && playhead < c.timelineStart + c.duration;
    })
    .sort((a, b) => {
      const ta = tracks.findIndex((t) => t.id === a.trackId);
      const tb = tracks.findIndex((t) => t.id === b.trackId);
      return tb - ta; // higher track index = on top
    });

  const visibleAudioClips = clips.filter((c) => {
    if (c.kind !== 'audio') return false;
    if (!c.enabled) return false;
    const track = tracks.find((t) => t.id === c.trackId);
    if (!track || track.hidden || track.muted) return false;
    return playhead >= c.timelineStart && playhead < c.timelineStart + c.duration;
  });

  // Sync video/audio elements with playhead + playing state
  useEffect(() => {
    const allMedia: (HTMLVideoElement | HTMLAudioElement)[] = [
      ...videoRefs.current.values(),
      ...audioRefs.current.values(),
    ];
    for (const el of allMedia) {
      const clipId = el.dataset.clipId;
      if (!clipId) continue;
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) continue;
      const localTime = (playhead - clip.timelineStart) * clip.speed + clip.sourceStart;
      if (Math.abs(el.currentTime - localTime) > 0.15) {
        try { el.currentTime = Math.max(0, localTime); } catch { /* */ }
      }
      if (playing) {
        el.playbackRate = clip.speed * playbackSpeed;
        el.muted = muted || clip.audio.muted;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
      }
    }
  }, [playhead, playing, clips, playbackSpeed, muted]);

  // Cleanup orphaned refs
  useEffect(() => {
    const validIds = new Set(clips.map((c) => c.id));
    for (const [id] of videoRefs.current) {
      if (!validIds.has(id)) videoRefs.current.delete(id);
    }
    for (const [id] of audioRefs.current) {
      if (!validIds.has(id)) audioRefs.current.delete(id);
    }
  }, [clips]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const canvasAspect = project ? project.width / project.height : 16 / 9;
  const isVertical = canvasAspect < 1;

  return (
    <div className="flex flex-1 min-w-0 flex-col bg-[#08080c] min-h-0">
      {/* Preview area */}
      <div
        ref={containerRef}
        className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden p-4 sm:p-6"
        onDoubleClick={toggleFullscreen}
        style={{ background: 'radial-gradient(ellipse at center, #111118 0%, #08080c 100%)' }}
      >
        {/* Empty state */}
        {visibleVideoClips.length === 0 && clips.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Play className="h-9 w-9 text-primary" />
            </div>
            <h3 className="text-lg font-medium">Your timeline is empty</h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">
              Import media from the left panel, record video, or start from a template.
            </p>
          </div>
        )}

        {/* Canvas frame */}
        <div
          className="relative shadow-2xl ring-1 ring-white/5 overflow-hidden bg-black"
          style={{
            aspectRatio: `${canvasAspect}`,
            height: isVertical ? 'min(85%, 520px)' : undefined,
            width: isVertical ? undefined : 'min(100%, calc((100vh - 280px) * ' + canvasAspect + '))',
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          {/* Render visible video clips stacked by z-index */}
          {visibleVideoClips.map((clip, idx) => {
            const asset = useEditorStore.getState().assets.find((a) => a.id === clip.assetId);
            const src = asset ? `/api/assets/${asset.id}` : undefined;
            const isImage = clip.kind === 'image';
            const t = clip.transform;
            return (
              <div
                key={clip.id}
                className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: idx + 1, opacity: t.opacity }}
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={clip.label || 'clip'}
                    className="max-w-full max-h-full object-contain drag-none"
                    style={{
                      transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`,
                    }}
                  />
                ) : (
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(clip.id, el);
                      else videoRefs.current.delete(clip.id);
                    }}
                    data-clip-id={clip.id}
                    src={src}
                    className="max-w-full max-h-full object-contain drag-none"
                    style={{
                      transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`,
                    }}
                    playsInline
                    preload="auto"
                  />
                )}
              </div>
            );
          })}

          {/* Text overlays */}
          {clips
            .filter((c) => c.kind === 'text' && c.enabled && playhead >= c.timelineStart && playhead < c.timelineStart + c.duration)
            .sort((a, b) => tracks.findIndex((t) => t.id === b.trackId) - tracks.findIndex((t) => t.id === a.trackId))
            .map((clip) => {
              const t = clip.transform;
              const style = clip.text;
              if (!style) return null;
              return (
                <div
                  key={clip.id}
                  className="absolute pointer-events-none flex"
                  style={{
                    left: '50%', top: '50%',
                    transform: `translate(calc(-50% + ${t.x}px), calc(-50% + ${t.y}px)) scale(${t.scale}) rotate(${t.rotation}deg)`,
                    opacity: t.opacity,
                    zIndex: 50,
                  }}
                >
                  <span
                    style={{
                      fontFamily: style.fontFamily,
                      fontSize: style.fontSize,
                      fontWeight: style.fontWeight,
                      fontStyle: style.italic ? 'italic' : 'normal',
                      letterSpacing: style.letterSpacing,
                      lineHeight: style.lineHeight,
                      textAlign: style.align,
                      color: style.color,
                      WebkitTextStroke: style.stroke ? `${style.stroke.width}px ${style.stroke.color}` : undefined,
                      textShadow: style.shadow ? `${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur}px ${style.shadow.color}` : undefined,
                      background: style.background ? style.background.color : undefined,
                      padding: style.background ? style.background.padding : undefined,
                      borderRadius: style.background ? style.background.rounded : undefined,
                    }}
                  >
                    {style.text || 'Text'}
                  </span>
                </div>
              );
            })}

          {/* Hidden audio elements for playback */}
          {visibleAudioClips.map((clip) => {
            const asset = useEditorStore.getState().assets.find((a) => a.id === clip.assetId);
            const src = asset ? `/api/assets/${asset.id}` : undefined;
            return (
              <audio
                key={clip.id}
                ref={(el) => { if (el) audioRefs.current.set(clip.id, el); }}
                data-clip-id={clip.id}
                src={src}
                preload="auto"
              />
            );
          })}

          {/* Canvas grid overlay (subtle) */}
          <div className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity">
            <div className="absolute inset-0 bg-grid-sm opacity-20" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20" />
          </div>

          {/* Resolution badge */}
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-mono text-white/80">
            {project?.width}×{project?.height} · {project?.fps}fps
          </div>
        </div>
      </div>

      {/* Transport / playback controls */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border/60 bg-editor-panel px-3">
        {/* Timecode display */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-foreground tabular-nums">
            {formatTimecode(playhead, fps, timecodeFormat)}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground tabular-nums">
            {formatTimecode(duration, fps, timecodeFormat)}
          </span>
        </div>

        <div className="w-px h-5 bg-border/60 mx-1.5" />

        {/* Transport */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seekTo(0)}>
                <SkipBack className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to start <kbd className="ml-1 text-[10px] opacity-70">Home</kbd></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => stepFrame(-1, fps)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Previous frame <kbd className="ml-1 text-[10px] opacity-70">←</kbd></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 mx-0.5 bg-accent/40" onClick={togglePlay}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{playing ? 'Pause' : 'Play'} <kbd className="ml-1 text-[10px] opacity-70">Space</kbd></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => stepFrame(1, fps)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Next frame <kbd className="ml-1 text-[10px] opacity-70">→</kbd></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seekTo(duration)}>
                <SkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to end <kbd className="ml-1 text-[10px] opacity-70">End</kbd></TooltipContent>
          </Tooltip>
        </div>

        <div className="w-px h-5 bg-border/60 mx-1.5" />

        {/* Split at playhead */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={splitAtPlayhead}>
              <Scissors className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Split at playhead <kbd className="ml-1 text-[10px] opacity-70">S</kbd></TooltipContent>
        </Tooltip>

        {/* Mute */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMuted((m) => !m)}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{muted ? 'Unmute preview' : 'Mute preview'}</TooltipContent>
        </Tooltip>

        {/* Snap toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${snap ? 'text-primary' : ''}`} onClick={toggleSnap}>
              <Magnet className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Snapping {snap ? 'on' : 'off'}</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Speed */}
        <DropdownSpeed value={playbackSpeed} onChange={setPlaybackSpeed} />

        {/* Preview quality */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowSettings((s) => !s)}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Preview quality</TooltipContent>
          </Tooltip>
          {showSettings && (
            <div className="absolute bottom-10 right-0 z-40 w-44 rounded-lg border border-border/60 bg-popover p-1.5 shadow-xl">
              <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">Preview quality</p>
              {(['full', 'half', 'proxy'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => { setPreviewQuality(q); setShowSettings(false); }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm capitalize ${
                    previewQuality === q ? 'bg-accent text-foreground' : 'hover:bg-accent/50 text-muted-foreground'
                  }`}
                >
                  {q === 'full' ? 'Full' : q === 'half' ? 'Half' : 'Proxy'}
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {q === 'full' ? '1:1' : q === 'half' ? '1:2' : '1:4'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fullscreen */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
              {isFs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{isFs ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
        </Tooltip>

        {/* Online indicator */}
        <div className="hidden sm:flex items-center gap-1.5 ml-2 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {online ? 'Online' : 'Offline'}
        </div>
      </div>
    </div>
  );
}

function DropdownSpeed({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setOpen((o) => !o)}>
            <Gauge className="h-4 w-4" />
            <span className="font-mono text-xs">{value}×</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Playback speed</TooltipContent>
      </Tooltip>
      {open && (
        <div className="absolute bottom-10 right-0 z-40 w-28 rounded-lg border border-border/60 bg-popover p-1.5 shadow-xl">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 rounded text-sm font-mono ${
                value === s ? 'bg-accent text-foreground' : 'hover:bg-accent/50 text-muted-foreground'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
