'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Type, Sparkles, Plus } from 'lucide-react';
import { createClip, createTrack } from '@/lib/timeline';
import type { TextStyle } from '@/lib/types';

const TEXT_PRESETS: { name: string; style: Partial<TextStyle>; icon: string }[] = [
  { name: 'Heading', style: { fontFamily: 'Geist', fontSize: 72, fontWeight: 800, color: '#ffffff' }, icon: 'H' },
  { name: 'Subheading', style: { fontFamily: 'Geist', fontSize: 42, fontWeight: 600, color: '#ffffff' }, icon: 'S' },
  { name: 'Body', style: { fontFamily: 'Inter', fontSize: 28, fontWeight: 400, color: '#ffffff' }, icon: 'B' },
  { name: 'Caption', style: { fontFamily: 'Inter', fontSize: 22, fontWeight: 600, color: '#ffffff', background: { color: '#000000', rounded: 4, padding: 6 } }, icon: 'C' },
  { name: 'Amber', style: { fontFamily: 'Geist', fontSize: 56, fontWeight: 800, color: '#f5a623' }, icon: 'A' },
  { name: 'Outlined', style: { fontFamily: 'Impact', fontSize: 64, fontWeight: 900, color: '#ffffff', stroke: { color: '#000000', width: 2 } }, icon: 'O' },
  { name: 'Shadow', style: { fontFamily: 'Geist', fontSize: 52, fontWeight: 700, color: '#ffffff', shadow: { color: '#000000', blur: 8, x: 2, y: 2 } }, icon: 'D' },
  { name: 'Lower third', style: { fontFamily: 'Inter', fontSize: 28, fontWeight: 500, color: '#ffffff', background: { color: 'rgba(0,0,0,0.7)', rounded: 4, padding: 6 } }, icon: 'L' },
];

const ANIMATIONS = [
  { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade in' },
  { id: 'typewriter', label: 'Typewriter' }, { id: 'pop', label: 'Pop' },
  { id: 'bounce', label: 'Bounce' }, { id: 'slide', label: 'Slide' },
  { id: 'zoom', label: 'Zoom' }, { id: 'glitch', label: 'Glitch' },
  { id: 'word', label: 'Word-by-word' }, { id: 'char', label: 'Character' },
];

export function TextPanel() {
  const tracks = useEditorStore((s) => s.tracks);
  const addClip = useEditorStore((s) => s.addClip);
  const playhead = useEditorStore((s) => s.playhead);

  const addText = (preset: typeof TEXT_PRESETS[number], customText?: string) => {
    let track = tracks.find((t) => t.kind === 'text' && !t.locked);
    if (!track) {
      track = createTrack('text');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const text: TextStyle = {
      text: customText ?? preset.name,
      fontFamily: 'Inter',
      fontSize: 28,
      fontWeight: 400,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      align: 'center',
      color: '#ffffff',
      animation: 'none',
      ...preset.style,
    };
    const clip = createClip({
      trackId: track.id,
      kind: 'text',
      timelineStart: playhead,
      duration: 4,
      label: text.text,
      text,
    });
    addClip(clip);
    toast.success(`Added "${text.text}"`);
  };

  const addQuickText = () => addText({ name: 'Text', style: { fontFamily: 'Geist', fontSize: 48, fontWeight: 600, color: '#ffffff' }, icon: 'T' }, 'Your text here');

  return (
    <div className="flex flex-col gap-3 p-3">
      <button onClick={addQuickText} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition">
        <Plus className="h-4 w-4" /> Add text
      </button>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Type className="h-3 w-3" /> Text styles
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => addText(preset)}
              className="rounded-lg border border-border/40 bg-background/40 hover:border-primary/50 hover:bg-accent/30 p-2.5 text-left transition"
            >
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded bg-muted/40 flex items-center justify-center text-sm font-bold">{preset.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{preset.name}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Animations
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {ANIMATIONS.map((a) => (
            <span key={a.id} className="px-2 py-1 rounded text-[11px] bg-muted/40 text-muted-foreground">{a.label}</span>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Select a text clip on the timeline, then choose an animation in the inspector.</p>
      </div>
    </div>
  );
}
