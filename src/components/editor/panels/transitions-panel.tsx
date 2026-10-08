'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { ArrowLeftRight, Plus } from 'lucide-react';
import type { TransitionType } from '@/lib/types';

const TRANSITIONS: { id: TransitionType; label: string; icon: string; color: string }[] = [
  { id: 'cut', label: 'Cut', icon: '✂', color: 'from-zinc-600 to-zinc-700' },
  { id: 'cross-dissolve', label: 'Cross Dissolve', icon: '◐', color: 'from-amber-600 to-orange-700' },
  { id: 'fade', label: 'Fade', icon: ' fading', color: 'from-zinc-700 to-stone-800' },
  { id: 'dip-to-black', label: 'Dip to Black', icon: '■', color: 'from-zinc-800 to-black' },
  { id: 'dip-to-white', label: 'Dip to White', icon: '□', color: 'from-zinc-200 to-amber-100' },
  { id: 'wipe', label: 'Wipe', icon: '▷', color: 'from-amber-600 to-stone-700' },
  { id: 'slide', label: 'Slide', icon: '→', color: 'from-orange-600 to-amber-700' },
  { id: 'zoom', label: 'Zoom', icon: '⊕', color: 'from-amber-700 to-rose-700' },
  { id: 'blur', label: 'Blur', icon: '◌', color: 'from-stone-600 to-amber-700' },
  { id: 'spin', label: 'Spin', icon: '↻', color: 'from-amber-600 to-orange-600' },
  { id: 'glitch', label: 'Glitch', icon: '⚡', color: 'from-fuchsia-700 to-amber-700' },
  { id: 'light-leak', label: 'Light Leak', icon: '✦', color: 'from-amber-500 to-orange-600' },
  { id: 'film-burn', label: 'Film Burn', icon: '◉', color: 'from-orange-700 to-red-800' },
  { id: 'flash', label: 'Flash', icon: '✸', color: 'from-amber-300 to-stone-700' },
  { id: 'whip-pan', label: 'Whip Pan', icon: '⇆', color: 'from-amber-700 to-stone-700' },
  { id: 'morph', label: 'Morph', icon: '∞', color: 'from-violet-700 to-amber-700' },
  { id: 'push', label: 'Push', icon: '⇨', color: 'from-amber-600 to-stone-600' },
];

export function TransitionsPanel() {
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const update = useEditorStore((s) => s.updateClip);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  const applyTransition = (type: TransitionType) => {
    if (!selectedClip) {
      toast.error('Select a clip first');
      return;
    }
    pushHistory('Add transition');
    update(selectedClip.id, {
      transitions: [...selectedClip.transitions, { id: `tr_${Date.now()}`, type, duration: 0.5 }],
    });
    toast.success(`Added ${type.replace('-', ' ')} transition`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {!selectedClip ? (
        <div className="rounded-lg border border-dashed border-border/40 p-4 text-center">
          <ArrowLeftRight className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
          <p className="text-xs text-muted-foreground">Select a clip to add transitions.</p>
        </div>
      ) : (
        <div className="rounded-md bg-accent/30 px-3 py-2 text-xs">
          Add transition to: <span className="font-medium">{selectedClip.label || selectedClip.kind}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => applyTransition(t.id)}
            disabled={!selectedClip}
            className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden hover:border-primary/50 hover:bg-accent/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className={`aspect-video bg-gradient-to-br ${t.color} flex items-center justify-center text-2xl text-white/80`}>
              {t.icon}
            </div>
            <div className="px-2 py-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium">{t.label}</span>
              <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </div>
          </button>
        ))}
      </div>

      {selectedClip && selectedClip.transitions.length > 0 && (
        <div className="rounded-md border border-border/40 bg-background/30 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Active transitions</p>
          <div className="space-y-1">
            {selectedClip.transitions.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[11px]">
                <span className="capitalize flex-1">{t.type.replace('-', ' ')}</span>
                <span className="font-mono text-muted-foreground">{t.duration}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
