'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import {
  ArrowLeft, Undo2, Redo2, Download, Play, Pause, Scissors, ChevronLeft, ChevronRight,
  SkipBack, SkipForward, Plus, Film, Music, Type, Captions, Sparkles, Wand2,
  ArrowLeftRight, Layers, Palette, Box, Sliders,
} from 'lucide-react';
import { formatTimecode } from '@/lib/timeline';

const TOOLS = [
  { id: 'media', label: 'Edit', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Captions },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'filters', label: 'Filters', icon: Wand2 },
  { id: 'transitions', label: 'Transitions', icon: ArrowLeftRight },
  { id: 'speed', label: 'Speed', icon: Sliders },
  { id: 'ai', label: 'AI', icon: Box },
];

export function EditorMobileView() {
  const openDashboard = useUIStore((s) => s.openDashboard);
  const setExportDialogOpen = useUIStore((s) => s.setExportDialogOpen);
  const setAiAssistantOpen = useUIStore((s) => s.setAiAssistantOpen);
  const setActiveSidebarTab = useUIStore((s) => s.setActiveSidebarTab);

  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => s.duration);
  const playing = useEditorStore((s) => s.playing);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const stepFrame = useEditorStore((s) => s.stepFrame);
  const seekTo = useEditorStore((s) => s.seekTo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const selectClip = useEditorStore((s) => s.selectClip);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);

  const [toolSheetOpen, setToolSheetOpen] = useState(false);
  const [activeTool, setActiveTool] = useState('media');

  const fps = project?.fps ?? 30;
  const pxPerSec = 40;

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 bg-editor-panel px-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDashboard()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{project?.name ?? 'Untitled'}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" className="h-8" onClick={() => setExportDialogOpen(true)}>
          <Download className="h-4 w-4" />
        </Button>
      </header>

      {/* Preview */}
      <div className="flex-1 min-h-0 flex flex-col bg-[#08080c]">
        <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
          <div
            className="relative bg-black shadow-2xl overflow-hidden max-h-full max-w-full"
            style={{ aspectRatio: `${project ? project.width / project.height : 16 / 9}`, height: '100%' }}
          >
            {/* Render topmost visible video clip */}
            {clips
              .filter((c) => (c.kind === 'video' || c.kind === 'image') && c.enabled && playhead >= c.timelineStart && playhead < c.timelineStart + c.duration)
              .sort((a, b) => tracks.findIndex((t) => t.id === b.trackId) - tracks.findIndex((t) => t.id === a.trackId))
              .slice(-1)
              .map((clip) => {
                const asset = useEditorStore.getState().assets.find((a) => a.id === clip.assetId);
                const src = asset ? `/api/assets/${asset.id}` : undefined;
                return clip.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={clip.id} src={src} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <video key={clip.id} src={src} className="max-w-full max-h-full object-contain" playsInline muted />
                );
              })}
            {clips.filter((c) => (c.kind === 'video' || c.kind === 'image') && c.enabled && playhead >= c.timelineStart && playhead < c.timelineStart + c.duration).length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Film className="h-10 w-10 text-white/20" />
              </div>
            )}
            {/* Text overlays */}
            {clips
              .filter((c) => c.kind === 'text' && c.enabled && playhead >= c.timelineStart && playhead < c.timelineStart + c.duration)
              .map((clip) => clip.text && (
                <div key={clip.id} className="absolute pointer-events-none" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                  <span style={{
                    fontFamily: clip.text.fontFamily, fontSize: clip.text.fontSize * 0.5, fontWeight: clip.text.fontWeight,
                    fontStyle: clip.text.italic ? 'italic' : 'normal', color: clip.text.color, textAlign: clip.text.align,
                    letterSpacing: clip.text.letterSpacing,
                  }}>{clip.text.text}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Transport */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border/60 bg-editor-panel px-3">
          <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatTimecode(playhead, fps)}
          </div>
          <div className="flex-1 flex items-center justify-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => seekTo(0)}><SkipBack className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => stepFrame(-1, fps)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={togglePlay}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => stepFrame(1, fps)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => seekTo(duration)}><SkipForward className="h-4 w-4" /></Button>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={splitAtPlayhead}><Scissors className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Timeline strip (horizontal) */}
      <div className="shrink-0 border-t border-border/60 bg-editor-panel-elevated max-h-32 overflow-y-auto">
        <div className="p-2 space-y-1">
          {tracks.map((track) => {
            const trackClips = clips.filter((c) => c.trackId === track.id);
            return (
              <div key={track.id} className="relative h-10 rounded bg-timeline-track/40 overflow-hidden" onClick={(e) => { if (e.target === e.currentTarget) selectClip(null); }}>
                <div className="absolute left-1 top-0.5 text-[9px] text-muted-foreground z-10">{track.name}</div>
                {trackClips.map((clip) => {
                  const left = clip.timelineStart * pxPerSec;
                  const width = Math.max(20, clip.duration * pxPerSec);
                  const selected = selectedClipIds.includes(clip.id);
                  return (
                    <div
                      key={clip.id}
                      onClick={() => selectClip(clip.id)}
                      className={`absolute top-1 bottom-1 rounded border ${selected ? 'border-primary ring-1 ring-primary' : 'border-border/60'} ${clip.kind === 'video' ? 'bg-amber-600/50' : clip.kind === 'audio' ? 'bg-emerald-600/50' : clip.kind === 'text' ? 'bg-fuchsia-600/50' : 'bg-sky-600/50'} overflow-hidden`}
                      style={{ left, width }}
                    >
                      <span className="absolute inset-0 px-1.5 flex items-center text-[9px] text-white/90 truncate">{clip.label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {/* Playhead indicator */}
        <div className="relative h-1 bg-timeline-ruler">
          <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${Math.min(100, (playhead / Math.max(duration, 1)) * 100)}%` }} />
        </div>
      </div>

      {/* Tool tray */}
      <div className="shrink-0 border-t border-border/60 bg-editor-panel">
        <div className="flex gap-1 overflow-x-auto scrollbar-thin p-2">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setActiveTool(t.id); setToolSheetOpen(true); if (t.id === 'ai') { setToolSheetOpen(false); setAiAssistantOpen(true); } else setActiveSidebarTab(t.id); }}
                className={`shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg min-w-16 ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px]">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tool sheet (shows the active panel content) */}
      <ToolSheet
        open={toolSheetOpen}
        onOpenChange={setToolSheetOpen}
        title={TOOLS.find((t) => t.id === activeTool)?.label ?? 'Tools'}
      >
        <MobilePanelContent tab={activeTool} />
      </ToolSheet>
    </div>
  );
}

function ToolSheet({ open, onOpenChange, title, children }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[60vh] bg-card border-border/60 p-0">
        <SheetHeader className="px-4 py-3 border-b border-border/40">
          <SheetTitle className="text-sm">{title}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto h-[calc(60vh-3rem)] scrollbar-thin">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MobilePanelContent({ tab }: { tab: string }) {
  // V19: panels use NAMED exports, not default exports. Import the named export
  // and wrap it as { default: Component } so the lazy-load type signature matches.
  const map: Record<string, () => Promise<{ default: React.ComponentType }>> = {
    media: async () => {
      const m = await import('@/components/editor/panels/media-panel');
      return { default: m.MediaPanel as React.ComponentType };
    },
    audio: async () => {
      const m = await import('@/components/editor/panels/audio-panel');
      return { default: m.AudioPanel as React.ComponentType };
    },
    text: async () => {
      const m = await import('@/components/editor/panels/text-panel');
      return { default: m.TextPanel as React.ComponentType };
    },
    captions: async () => {
      const m = await import('@/components/editor/panels/captions-panel');
      return { default: m.CaptionsPanel as React.ComponentType };
    },
    effects: async () => {
      const m = await import('@/components/editor/panels/effects-panel');
      return { default: m.EffectsPanel as React.ComponentType };
    },
    filters: async () => {
      const m = await import('@/components/editor/panels/filters-panel');
      return { default: m.FiltersPanel as React.ComponentType };
    },
    transitions: async () => {
      const m = await import('@/components/editor/panels/transitions-panel');
      return { default: m.TransitionsPanel as React.ComponentType };
    },
    scopes: async () => {
      const m = await import('@/components/editor/panels/color-scopes-panel');
      return { default: m.ColorScopesPanel as React.ComponentType };
    },
    transcript: async () => {
      const m = await import('@/components/editor/panels/transcript-panel');
      return { default: m.TranscriptPanel as React.ComponentType };
    },
    'ai-features': async () => {
      const m = await import('@/components/editor/panels/ai-features-panel');
      return { default: m.AiFeaturesPanel as React.ComponentType };
    },
  };
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  useState(() => {
    if (map[tab]) {
      map[tab]().then((m) => setComp(() => m.default));
    }
  });
  if (tab === 'speed' || tab === 'ai') {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        {tab === 'speed' ? 'Select a clip and use the inspector.' : 'AI assistant opened.'}
      </div>
    );
  }
  if (Comp) return <Comp />;
  return <div className="p-4 text-center text-sm text-muted-foreground">Loading…</div>;
}
