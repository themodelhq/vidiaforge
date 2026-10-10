'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Palette, Upload, Plus, Type, Droplet, Image as ImageIcon, Film } from 'lucide-react';

const BRAND_COLORS = ['#f5a623', '#e07b1a', '#0a0a0f', '#ffffff', '#1a1a24', '#facc15', '#fb923c', '#fde68a'];

export function BrandKitPanel() {
  const updateClip = useEditorStore((s) => s.updateClip);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  const applyColor = (color: string) => {
    if (!selectedClip?.text) {
      toast.error('Select a text clip first');
      return;
    }
    updateClip(selectedClip.id, { text: { ...selectedClip.text, color } });
    toast.success(`Applied brand color`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Palette className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Brand Kit</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Save your logo, colors, fonts, watermark, intro and outro. Apply to any project in one click.</p>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <ImageIcon className="h-3 w-3" /> Logo
        </h3>
        <button onClick={() => toast.info('Logo upload — coming soon')} className="w-full rounded-lg border-2 border-dashed border-border/60 p-4 hover:border-border transition flex flex-col items-center gap-1.5">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Upload logo</span>
        </button>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Droplet className="h-3 w-3" /> Brand colors
        </h3>
        <div className="grid grid-cols-4 gap-1.5">
          {BRAND_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => applyColor(c)}
              className="aspect-square rounded-lg border border-border/40 ring-1 ring-inset ring-white/10 hover:ring-primary/50 transition"
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          <button onClick={() => toast.info('Add custom color')} className="aspect-square rounded-lg border border-dashed border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Type className="h-3 w-3" /> Brand fonts
        </h3>
        <div className="space-y-1.5">
          {['Geist', 'Inter', 'Playfair Display'].map((f) => (
            <button key={f} onClick={() => toast.info(`Apply ${f} — select a text clip first`)} className="w-full rounded-md border border-border/40 bg-background/40 px-3 py-2 text-left hover:bg-accent/30 transition">
              <span className="text-sm" style={{ fontFamily: f }}>{f}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => toast.info('Watermark — coming soon')} className="rounded-lg border border-border/40 bg-background/40 p-3 text-center hover:bg-accent/30 transition">
          <ImageIcon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
          <span className="text-[11px]">Watermark</span>
        </button>
        <button onClick={() => toast.info('Intro/Outro — coming soon')} className="rounded-lg border border-border/40 bg-background/40 p-3 text-center hover:bg-accent/30 transition">
          <Film className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
          <span className="text-[11px]">Intro / Outro</span>
        </button>
      </div>
    </div>
  );
}
