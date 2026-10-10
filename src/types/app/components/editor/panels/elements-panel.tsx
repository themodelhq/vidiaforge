'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Box, Shapes, Square, Circle, Triangle, Minus, Star, Hexagon, Sparkles } from 'lucide-react';
import { createClip, createTrack } from '@/lib/timeline';

const SHAPES: { id: string; name: string; icon: React.ElementType; svg?: string }[] = [
  { id: 'rect', name: 'Rectangle', icon: Square },
  { id: 'rounded', name: 'Rounded', icon: Square },
  { id: 'circle', name: 'Circle', icon: Circle },
  { id: 'triangle', name: 'Triangle', icon: Triangle },
  { id: 'line', name: 'Line', icon: Minus },
  { id: 'star', name: 'Star', icon: Star },
  { id: 'hexagon', name: 'Hexagon', icon: Hexagon },
];

const OVERLAYS: { id: string; name: string; gradient: string }[] = [
  { id: 'grad1', name: 'Amber Glow', gradient: 'from-amber-500/40 to-transparent' },
  { id: 'grad2', name: 'Sunset', gradient: 'from-orange-600/40 to-rose-600/40' },
  { id: 'grad3', name: 'Warm Wash', gradient: 'from-amber-400/30 to-transparent' },
  { id: 'grad4', name: 'Vignette', gradient: 'from-transparent to-black/60' },
  { id: 'grad5', name: 'Light Leak', gradient: 'from-amber-300/50 via-transparent to-rose-400/30' },
  { id: 'grad6', name: 'Film Burn', gradient: 'from-orange-700/50 to-yellow-500/40' },
];

const ADJUSTMENTS: { id: string; name: string; desc: string }[] = [
  { id: 'color-grade', name: 'Color Grade', desc: 'Apply to all clips below' },
  { id: 'blur-layer', name: 'Blur Layer', desc: 'Blur everything below' },
  { id: 'grain', name: 'Film Grain', desc: 'Add cinematic grain' },
  { id: 'lut', name: 'LUT', desc: 'Apply a .cube LUT file' },
];

export function ElementsPanel() {
  const tracks = useEditorStore((s) => s.tracks);
  const addClip = useEditorStore((s) => s.addClip);
  const playhead = useEditorStore((s) => s.playhead);

  const addShape = (name: string) => {
    let track = tracks.find((t) => t.kind === 'overlay' && !t.locked);
    if (!track) {
      track = createTrack('overlay', 'Elements');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const clip = createClip({
      trackId: track.id,
      kind: 'shape',
      timelineStart: playhead,
      duration: 3,
      label: name,
    });
    addClip(clip);
    toast.success(`Added ${name}`);
  };

  const addOverlay = (name: string) => {
    let track = tracks.find((t) => t.kind === 'overlay' && !t.locked);
    if (!track) {
      track = createTrack('overlay', 'Overlays');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const clip = createClip({
      trackId: track.id,
      kind: 'effect',
      timelineStart: playhead,
      duration: 3,
      label: name,
    });
    addClip(clip);
    toast.success(`Added ${name} overlay`);
  };

  const addAdjustment = (name: string) => {
    let track = tracks.find((t) => t.kind === 'adjustment' && !t.locked);
    if (!track) {
      track = createTrack('adjustment', 'Adjustments');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const clip = createClip({
      trackId: track.id,
      kind: 'adjustment',
      timelineStart: playhead,
      duration: 5,
      label: name,
    });
    addClip(clip);
    toast.success(`Added ${name} layer`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Shapes className="h-3 w-3" /> Shapes
        </h3>
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPES.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => addShape(s.name)}
                className="aspect-square rounded-lg border border-border/40 bg-background/40 hover:border-primary/50 hover:bg-accent/30 transition flex flex-col items-center justify-center gap-0.5"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">{s.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Overlays
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              onClick={() => addOverlay(o.name)}
              className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden hover:border-primary/50 transition"
            >
              <div className={`aspect-video bg-gradient-to-br ${o.gradient} relative`}>
                <div className="absolute inset-0 bg-grid-sm opacity-20" />
              </div>
              <div className="px-2 py-1 text-[11px] font-medium">{o.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Box className="h-3 w-3" /> Adjustment layers
        </h3>
        <div className="space-y-1.5">
          {ADJUSTMENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => addAdjustment(a.name)}
              className="w-full rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-left hover:bg-accent/30 transition"
            >
              <div className="text-xs font-medium">{a.name}</div>
              <div className="text-[10px] text-muted-foreground">{a.desc}</div>
            </button>
          ))}
        </div>
        <button onClick={() => toast.info('LUT import — coming soon')} className="w-full mt-2 rounded-lg border border-dashed border-border/60 py-2 text-[11px] text-muted-foreground hover:bg-accent/20 transition">
          + Import .cube LUT
        </button>
      </div>
    </div>
  );
}
