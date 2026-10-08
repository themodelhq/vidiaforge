'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Wand2, Check } from 'lucide-react';
import type { FilterType } from '@/lib/types';

const FILTERS: { id: FilterType; label: string; gradient: string; overlay: string }[] = [
  { id: 'cinematic', label: 'Cinematic', gradient: 'from-amber-900 to-stone-900', overlay: 'mix-blend-overlay bg-amber-600/30' },
  { id: 'warm', label: 'Warm', gradient: 'from-orange-700 to-amber-600', overlay: 'mix-blend-soft-light bg-orange-500/40' },
  { id: 'cool', label: 'Cool', gradient: 'from-cyan-700 to-blue-800', overlay: 'mix-blend-soft-light bg-cyan-500/40' },
  { id: 'vintage', label: 'Vintage', gradient: 'from-amber-800 to-stone-700', overlay: 'mix-blend-multiply bg-amber-700/30' },
  { id: 'film', label: 'Film', gradient: 'from-stone-700 to-amber-900', overlay: 'mix-blend-overlay bg-stone-500/40' },
  { id: 'bw', label: 'B & W', gradient: 'from-zinc-700 to-zinc-900', overlay: 'grayscale' },
  { id: 'high-contrast', label: 'Contrast', gradient: 'from-zinc-600 to-zinc-900', overlay: 'contrast-150' },
  { id: 'moody', label: 'Moody', gradient: 'from-stone-800 to-zinc-900', overlay: 'mix-blend-multiply bg-stone-700/50' },
  { id: 'vibrant', label: 'Vibrant', gradient: 'from-amber-600 to-rose-600', overlay: 'saturate-150' },
  { id: 'portrait', label: 'Portrait', gradient: 'from-rose-700 to-amber-700', overlay: 'mix-blend-soft-light bg-rose-400/30' },
  { id: 'golden-hour', label: 'Golden', gradient: 'from-amber-500 to-orange-700', overlay: 'mix-blend-overlay bg-amber-400/50' },
];

export function FiltersPanel() {
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const update = useEditorStore((s) => s.updateClip);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  const applyFilter = (type: FilterType) => {
    if (!selectedClip) {
      toast.error('Select a clip first');
      return;
    }
    const existing = selectedClip.filters.find((f) => f.type === type);
    if (existing) {
      toast.info('Filter already applied — adjust intensity in the inspector');
      return;
    }
    pushHistory('Add filter');
    update(selectedClip.id, {
      filters: [...selectedClip.filters, { id: `flt_${Date.now()}`, type, intensity: 0.5, enabled: true }],
    });
    toast.success(`Applied ${type.replace('-', ' ')} filter`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {!selectedClip ? (
        <div className="rounded-lg border border-dashed border-border/40 p-4 text-center">
          <Wand2 className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
          <p className="text-xs text-muted-foreground">Select a clip to apply filters.</p>
        </div>
      ) : (
        <div className="rounded-md bg-accent/30 px-3 py-2 text-xs">
          Filters on: <span className="font-medium">{selectedClip.label || selectedClip.kind}</span>
          <span className="text-muted-foreground ml-1">({selectedClip.filters.length})</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {FILTERS.map((f) => {
          const isActive = selectedClip?.filters.some((cf) => cf.type === f.id);
          return (
            <button
              key={f.id}
              onClick={() => applyFilter(f.id)}
              disabled={!selectedClip}
              className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden hover:border-primary/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className={`aspect-video bg-gradient-to-br ${f.gradient} relative overflow-hidden`}>
                <div className={`absolute inset-0 ${f.overlay}`} />
                <div className="absolute inset-0 bg-grid-sm opacity-20" />
                {isActive && (
                  <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-medium">{f.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedClip && selectedClip.filters.length > 0 && (
        <div className="rounded-md border border-border/40 bg-background/30 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Active filters</p>
          <div className="space-y-1">
            {selectedClip.filters.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className="capitalize flex-1">{f.type.replace('-', ' ')}</span>
                <span className="font-mono text-muted-foreground">{Math.round(f.intensity * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
