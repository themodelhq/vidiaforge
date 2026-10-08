'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Sparkles, Plus } from 'lucide-react';
import type { EffectType } from '@/lib/types';

const EFFECTS: { id: EffectType; label: string; preview: string; desc: string }[] = [
  { id: 'blur', label: 'Blur', preview: 'blur-sm', desc: 'Soft blur' },
  { id: 'gaussian-blur', label: 'Gaussian Blur', preview: 'blur-md', desc: 'Stronger blur' },
  { id: 'motion-blur', label: 'Motion Blur', preview: '', desc: 'Directional blur' },
  { id: 'glow', label: 'Glow', preview: '', desc: 'Soft luminous glow' },
  { id: 'sharpen', label: 'Sharpen', preview: '', desc: 'Enhance edges' },
  { id: 'vignette', label: 'Vignette', preview: '', desc: 'Darken edges' },
  { id: 'noise', label: 'Noise', preview: '', desc: 'Add grain noise' },
  { id: 'grain', label: 'Film Grain', preview: '', desc: 'Cinematic grain' },
  { id: 'chromatic-aberration', label: 'Chromatic', preview: '', desc: 'RGB split fringe' },
  { id: 'glitch', label: 'Glitch', preview: '', desc: 'Digital glitch' },
  { id: 'pixelate', label: 'Pixelate', preview: '', desc: 'Mosaic pixels' },
  { id: 'vhs', label: 'VHS', preview: '', desc: 'Retro tape look' },
  { id: 'film', label: 'Film', preview: '', desc: 'Old film stock' },
  { id: 'rgb-split', label: 'RGB Split', preview: '', desc: 'Channel separation' },
  { id: 'lens-distortion', label: 'Lens', preview: '', desc: 'Barrel distortion' },
  { id: 'bloom', label: 'Bloom', preview: '', desc: 'HDR bloom' },
];

export function EffectsPanel() {
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const update = useEditorStore((s) => s.updateClip);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  const applyEffect = (type: EffectType) => {
    if (!selectedClip) {
      toast.error('Select a clip first');
      return;
    }
    pushHistory('Add effect');
    update(selectedClip.id, {
      effects: [...selectedClip.effects, { id: `fx_${Date.now()}`, type, intensity: 0.5, enabled: true }],
    });
    toast.success(`Added ${type.replace('-', ' ')}`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {!selectedClip ? (
        <div className="rounded-lg border border-dashed border-border/40 p-4 text-center">
          <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
          <p className="text-xs text-muted-foreground">Select a clip to apply effects.</p>
        </div>
      ) : (
        <div className="rounded-md bg-accent/30 px-3 py-2 text-xs">
          Effects applied to: <span className="font-medium">{selectedClip.label || selectedClip.kind}</span>
          <span className="text-muted-foreground ml-1">({selectedClip.effects.length} active)</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {EFFECTS.map((fx) => (
          <button
            key={fx.id}
            onClick={() => applyEffect(fx.id)}
            disabled={!selectedClip}
            className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden hover:border-primary/50 hover:bg-accent/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="aspect-video bg-gradient-to-br from-zinc-700 via-zinc-800 to-black flex items-center justify-center relative overflow-hidden">
              <div className={`absolute inset-0 ${fx.preview} bg-grid-sm opacity-30`} />
              <div className="relative text-[10px] font-mono text-white/60">{fx.desc}</div>
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <Plus className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="px-2 py-1.5">
              <div className="text-[11px] font-medium">{fx.label}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
