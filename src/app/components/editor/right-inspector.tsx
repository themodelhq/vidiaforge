'use client';

import { useState } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useUIStore } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Move, RotateCw, Scaling, Droplet, Crop as CropIcon, Palette, AudioLines, Gauge,
  Blend, Sparkles, Key, ChevronDown, ChevronRight, ChevronLeft, Eye, Lock, Plus, Trash2,
  Shapes, Wand2, Scissors,
} from 'lucide-react';
import { formatTimecode } from '@/lib/timeline';
import type { EffectType, BlendMode, EasingType, MaskShape } from '@/lib/types';

export function RightInspector() {
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const collapsed = useUIStore((s) => s.inspectorCollapsed);
  const toggle = useUIStore((s) => s.toggleInspector);

  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]) ?? null;
  const selectedTrack = selectedClip ? tracks.find((t) => t.id === selectedClip.trackId) ?? null : null;

  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-l border-border/60 bg-editor-panel py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              aria-label="Show inspector"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Show inspector</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-l border-border/60 bg-editor-panel">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {selectedClip ? 'Properties' : 'Inspector'}
        </h2>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                aria-label="Hide inspector"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Hide inspector</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!selectedClip ? (
        <EmptyInspector />
      ) : (
        <ScrollArea className="flex-1 scrollbar-thin">
          <div className="p-3 space-y-1">
            {/* Clip header */}
            <div className="rounded-md bg-accent/30 px-3 py-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate flex-1">{selectedClip.label || selectedClip.kind}</span>
                <Badge>{selectedClip.kind}</Badge>
              </div>
              {selectedTrack && (
                <div className="text-[11px] text-muted-foreground mt-0.5">on {selectedTrack.name}</div>
              )}
            </div>

            <Section title="Transform" icon={Move} defaultOpen>
              <TransformSection clipId={selectedClip.id} />
            </Section>

            <Section title="Crop" icon={CropIcon} defaultOpen={false}>
              <CropSection clipId={selectedClip.id} />
            </Section>

            <Section title="Color" icon={Palette} defaultOpen={false}>
              <ColorSection clipId={selectedClip.id} />
            </Section>

            <Section title="Speed" icon={Gauge} defaultOpen={false}>
              <SpeedSection clipId={selectedClip.id} />
            </Section>

            {(selectedClip.kind === 'video' || selectedClip.kind === 'audio') && (
              <Section title="Audio" icon={AudioLines} defaultOpen={false}>
                <AudioSection clipId={selectedClip.id} />
              </Section>
            )}

            {selectedClip.kind === 'text' && (
              <Section title="Text" icon={Sparkles} defaultOpen>
                <TextSection clipId={selectedClip.id} />
              </Section>
            )}

            <Section title="Effects" icon={Sparkles} defaultOpen={false}>
              <EffectsSection clipId={selectedClip.id} />
            </Section>

            {(selectedClip.kind === 'video' || selectedClip.kind === 'image') && (
              <Section title="Masks" icon={Shapes} defaultOpen={false}>
                <MaskSection clipId={selectedClip.id} />
              </Section>
            )}

            {(selectedClip.kind === 'video' || selectedClip.kind === 'image') && (
              <Section title="Chroma Key" icon={Wand2} defaultOpen={false}>
                <ChromaKeySection clipId={selectedClip.id} />
              </Section>
            )}

            <Section title="Keyframes" icon={Key} defaultOpen={false}>
              <KeyframesSection clipId={selectedClip.id} />
            </Section>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">{children}</span>;
}

function EmptyInspector() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="h-12 w-12 rounded-xl bg-muted/30 flex items-center justify-center mb-3">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">Nothing selected</p>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-[200px]">
        Click a clip on the timeline to edit its transform, color, audio, effects, and keyframes.
      </p>
    </div>
  );
}

function Section({ title, icon: Icon, defaultOpen = true, children }: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border/40 bg-card/30 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent/30 transition"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/90">{title}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-center gap-2">
      <Label className="text-[11px] text-muted-foreground font-normal">{label}</Label>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, step = 1, min, max, suffix }: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="relative flex-1">
      <Input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step}
        min={min}
        max={max}
        className="h-7 bg-background/60 text-xs font-mono pr-5"
      />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function MiniSlider({ value, onChange, min = 0, max = 1, step = 0.01 }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Slider
      value={[value]}
      onValueChange={(v) => onChange(v[0])}
      min={min}
      max={max}
      step={step}
      className="flex-1"
    />
  );
}

function TransformSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const t = clip.transform;

  const setTransform = (patch: Partial<typeof t>, label = 'Transform') => {
    pushHistory(label);
    update(clipId, { transform: { ...t, ...patch } });
  };

  return (
    <>
      <Row label="Position">
        <NumberInput value={t.x} onChange={(v) => setTransform({ x: v }, 'Move X')} step={1} suffix="px" />
        <NumberInput value={t.y} onChange={(v) => setTransform({ y: v }, 'Move Y')} step={1} suffix="px" />
      </Row>
      <Row label="Scale">
        <MiniSlider value={t.scale} onChange={(v) => setTransform({ scale: v }, 'Scale')} min={0.1} max={4} step={0.01} />
        <NumberInput value={t.scale} onChange={(v) => setTransform({ scale: v }, 'Scale')} step={0.1} min={0.1} />
      </Row>
      <Row label="Rotation">
        <MiniSlider value={t.rotation} onChange={(v) => setTransform({ rotation: v }, 'Rotate')} min={-180} max={180} step={1} />
        <NumberInput value={t.rotation} onChange={(v) => setTransform({ rotation: v }, 'Rotate')} step={1} min={-180} max={180} suffix="°" />
      </Row>
      <Row label="Opacity">
        <MiniSlider value={t.opacity} onChange={(v) => setTransform({ opacity: v }, 'Opacity')} min={0} max={1} step={0.01} />
        <NumberInput value={Math.round(t.opacity * 100)} onChange={(v) => setTransform({ opacity: v / 100 }, 'Opacity')} step={1} min={0} max={100} suffix="%" />
      </Row>
      <Row label="Blend">
        <Select value={clip.blendMode} onValueChange={(v) => { pushHistory('Blend mode'); update(clipId, { blendMode: v as BlendMode }); }}>
          <SelectTrigger className="h-7 bg-background/60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'].map((b) => (
              <SelectItem key={b} value={b} className="text-xs capitalize">{b.replace('-', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}

function CropSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const c = clip.crop;
  const setCrop = (patch: Partial<typeof c>) => { pushHistory('Crop'); update(clipId, { crop: { ...c, ...patch } }); };
  return (
    <>
      <Row label="Top"><MiniSlider value={c.top} onChange={(v) => setCrop({ top: v })} /><NumberInput value={Math.round(c.top * 100)} onChange={(v) => setCrop({ top: v / 100 })} step={1} min={0} max={100} suffix="%" /></Row>
      <Row label="Bottom"><MiniSlider value={c.bottom} onChange={(v) => setCrop({ bottom: v })} /><NumberInput value={Math.round(c.bottom * 100)} onChange={(v) => setCrop({ bottom: v / 100 })} step={1} min={0} max={100} suffix="%" /></Row>
      <Row label="Left"><MiniSlider value={c.left} onChange={(v) => setCrop({ left: v })} /><NumberInput value={Math.round(c.left * 100)} onChange={(v) => setCrop({ left: v / 100 })} step={1} min={0} max={100} suffix="%" /></Row>
      <Row label="Right"><MiniSlider value={c.right} onChange={(v) => setCrop({ right: v })} /><NumberInput value={Math.round(c.right * 100)} onChange={(v) => setCrop({ right: v / 100 })} step={1} min={0} max={100} suffix="%" /></Row>
    </>
  );
}

function ColorSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const col = clip.color;
  const setColor = (patch: Partial<typeof col>, label: string) => { pushHistory(label); update(clipId, { color: { ...col, ...patch } }); };
  // V19: restrict keys to the numeric color fields (curves/wheels/lut are
  // object-valued and are edited in a dedicated sub-panel, not via MiniSlider).
  type NumericColorKey =
    | 'exposure' | 'brightness' | 'contrast'
    | 'highlights' | 'shadows' | 'whites' | 'blacks'
    | 'saturation' | 'vibrance'
    | 'temperature' | 'tint' | 'hue';
  const controls: { key: NumericColorKey; label: string }[] = [
    { key: 'exposure', label: 'Exposure' }, { key: 'brightness', label: 'Bright' }, { key: 'contrast', label: 'Contrast' },
    { key: 'highlights', label: 'Highlights' }, { key: 'shadows', label: 'Shadows' }, { key: 'whites', label: 'Whites' }, { key: 'blacks', label: 'Blacks' },
    { key: 'saturation', label: 'Saturat.' }, { key: 'vibrance', label: 'Vibrance' },
    { key: 'temperature', label: 'Temp' }, { key: 'tint', label: 'Tint' }, { key: 'hue', label: 'Hue' },
  ];
  return (
    <>
      {controls.map(({ key, label }) => (
        <Row key={key} label={label}>
          <MiniSlider value={col[key]} onChange={(v) => setColor({ [key]: v }, `Color ${label}`)} min={key === 'hue' ? -180 : -1} max={key === 'hue' ? 180 : 1} step={0.01} />
          <NumberInput value={Math.round(col[key] * 100)} onChange={(v) => setColor({ [key]: v / 100 }, `Color ${label}`)} step={1} min={key === 'hue' ? -180 : -100} max={key === 'hue' ? 180 : 100} />
        </Row>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs mt-1" onClick={() => setColor({ exposure:0,brightness:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0,temperature:0,tint:0,hue:0 }, 'Reset color')}>
        Reset color
      </Button>
    </>
  );
}

function SpeedSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const speeds = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8];
  return (
    <>
      <Row label="Speed">
        <MiniSlider value={clip.speed} onChange={(v) => { pushHistory('Speed'); update(clipId, { speed: v }); }} min={0.1} max={8} step={0.05} />
        <NumberInput value={clip.speed} onChange={(v) => { pushHistory('Speed'); update(clipId, { speed: v }); }} step={0.05} min={0.1} max={8} suffix="×" />
      </Row>
      <div className="flex flex-wrap gap-1 mt-1">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => { pushHistory('Speed'); update(clipId, { speed: s }); }}
            className={`px-2 py-1 rounded text-[11px] font-mono ${
              clip.speed === s ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <Label className="text-xs">Reverse</Label>
        <Switch checked={clip.reverse} onCheckedChange={(v) => { pushHistory('Reverse'); update(clipId, { reverse: v }); }} />
      </div>
    </>
  );
}

function AudioSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const a = clip.audio;
  const set = (patch: Partial<typeof a>, label: string) => { pushHistory(label); update(clipId, { audio: { ...a, ...patch } }); };
  return (
    <>
      <Row label="Volume">
        <MiniSlider value={a.volume} onChange={(v) => set({ volume: v }, 'Volume')} min={0} max={2} step={0.01} />
        <NumberInput value={Math.round(a.volume * 100)} onChange={(v) => set({ volume: v / 100 }, 'Volume')} step={1} min={0} max={200} suffix="%" />
      </Row>
      <Row label="Pan">
        <MiniSlider value={a.pan} onChange={(v) => set({ pan: v }, 'Pan')} min={-1} max={1} step={0.01} />
      </Row>
      <Row label="Fade in">
        <MiniSlider value={a.fadeIn} onChange={(v) => set({ fadeIn: v }, 'Fade in')} min={0} max={5} step={0.05} />
        <NumberInput value={a.fadeIn} onChange={(v) => set({ fadeIn: v }, 'Fade in')} step={0.1} min={0} suffix="s" />
      </Row>
      <Row label="Fade out">
        <MiniSlider value={a.fadeOut} onChange={(v) => set({ fadeOut: v }, 'Fade out')} min={0} max={5} step={0.05} />
        <NumberInput value={a.fadeOut} onChange={(v) => set({ fadeOut: v }, 'Fade out')} step={0.1} min={0} suffix="s" />
      </Row>
      <div className="flex items-center justify-between mt-2">
        <Label className="text-xs">Muted</Label>
        <Switch checked={a.muted} onCheckedChange={(v) => set({ muted: v }, 'Mute')} />
      </div>
    </>
  );
}

function TextSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip || !clip.text) return null;
  const t = clip.text;
  const set = (patch: Partial<typeof t>, label = 'Text') => { pushHistory(label); update(clipId, { text: { ...t, ...patch } }); };
  const fonts = ['Inter', 'Geist', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact', 'Helvetica', 'Roboto'];
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Content</Label>
        <textarea
          value={t.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={2}
          className="w-full rounded-md bg-background/60 border border-border/60 px-2 py-1.5 text-sm resize-none focus:outline-none focus:border-primary/50"
        />
      </div>
      <Row label="Font">
        <Select value={t.fontFamily} onValueChange={(v) => set({ fontFamily: v }, 'Font')}>
          <SelectTrigger className="h-7 bg-background/60 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{fonts.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Row label="Size">
        <MiniSlider value={t.fontSize} onChange={(v) => set({ fontSize: v }, 'Font size')} min={8} max={200} step={1} />
        <NumberInput value={t.fontSize} onChange={(v) => set({ fontSize: v }, 'Font size')} step={1} min={8} max={400} />
      </Row>
      <Row label="Weight">
        <Select value={String(t.fontWeight)} onValueChange={(v) => set({ fontWeight: parseInt(v) }, 'Weight')}>
          <SelectTrigger className="h-7 bg-background/60 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{[300,400,500,600,700,800,900].map((w) => <SelectItem key={w} value={String(w)} className="text-xs">{w}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Row label="Color">
        <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value }, 'Text color')} className="h-7 w-10 rounded bg-transparent cursor-pointer border border-border/60" />
        <Input value={t.color} onChange={(e) => set({ color: e.target.value }, 'Text color')} className="h-7 bg-background/60 text-xs font-mono flex-1" />
      </Row>
      <Row label="Spacing">
        <MiniSlider value={t.letterSpacing} onChange={(v) => set({ letterSpacing: v }, 'Letter spacing')} min={-5} max={20} step={0.1} />
      </Row>
      <Row label="Line H">
        <MiniSlider value={t.lineHeight} onChange={(v) => set({ lineHeight: v }, 'Line height')} min={0.5} max={3} step={0.05} />
      </Row>
      <Row label="Align">
        <div className="flex gap-1 flex-1">
          {(['left','center','right'] as const).map((a) => (
            <button key={a} onClick={() => set({ align: a }, 'Align')} className={`flex-1 h-7 rounded text-[11px] capitalize ${t.align === a ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'}`}>{a}</button>
          ))}
        </div>
      </Row>
      <div className="flex items-center justify-between mt-1">
        <Label className="text-xs">Italic</Label>
        <Switch checked={t.italic} onCheckedChange={(v) => set({ italic: v }, 'Italic')} />
      </div>
      <Row label="Anim">
        <Select value={t.animation ?? 'none'} onValueChange={(v) => set({ animation: v as typeof t.animation }, 'Text anim')}>
          <SelectTrigger className="h-7 bg-background/60 text-xs capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>{['none','fade','typewriter','pop','bounce','slide','zoom','glitch','word','char'].map((a) => <SelectItem key={a} value={a} className="text-xs capitalize">{a}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
    </>
  );
}

function EffectsSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;
  const effectTypes: EffectType[] = ['blur','gaussian-blur','motion-blur','glow','sharpen','vignette','noise','grain','chromatic-aberration','glitch','pixelate','vhs','film','rgb-split','lens-distortion','bloom'];
  return (
    <>
      {clip.effects.length === 0 && <p className="text-xs text-muted-foreground py-1">No effects applied.</p>}
      {clip.effects.map((fx) => (
        <div key={fx.id} className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Switch checked={fx.enabled} onCheckedChange={(v) => { pushHistory('Toggle effect'); update(clipId, { effects: clip.effects.map((e) => e.id === fx.id ? { ...e, enabled: v } : e) }); }} />
            <span className="text-xs font-medium capitalize flex-1">{fx.type.replace('-', ' ')}</span>
            <button onClick={() => { pushHistory('Remove effect'); update(clipId, { effects: clip.effects.filter((e) => e.id !== fx.id) }); }} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <Row label="Amount">
            <MiniSlider value={fx.intensity} onChange={(v) => update(clipId, { effects: clip.effects.map((e) => e.id === fx.id ? { ...e, intensity: v } : e) })} min={0} max={1} step={0.01} />
          </Row>
        </div>
      ))}
      <Select onValueChange={(v) => { pushHistory('Add effect'); const id = `fx_${Date.now()}`; update(clipId, { effects: [...clip.effects, { id, type: v as EffectType, intensity: 0.5, enabled: true }] }); }}>
        <SelectTrigger className="h-7 bg-background/60 text-xs"><Plus className="h-3 w-3 mr-1 inline" /> Add effect</SelectTrigger>
        <SelectContent>{effectTypes.map((t) => <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace('-', ' ')}</SelectItem>)}</SelectContent>
      </Select>
    </>
  );
}

function KeyframesSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const playhead = useEditorStore((s) => s.playhead);
  if (!clip) return null;
  const props = ['opacity','scale','rotation','x','y','volume'];
  const addKf = (property: string) => {
    const value = property === 'opacity' ? clip.transform.opacity : property === 'scale' ? clip.transform.scale : property === 'rotation' ? clip.transform.rotation : property === 'x' ? clip.transform.x : property === 'y' ? clip.transform.y : clip.audio.volume;
    pushHistory('Add keyframe');
    update(clipId, { keyframes: [...clip.keyframes, { id: `kf_${Date.now()}`, time: playhead - clip.timelineStart, property, value, easing: 'ease-in-out' }] });
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        {props.map((p) => (
          <Button key={p} variant="outline" size="sm" className="h-7 text-xs" onClick={() => addKf(p)}>
            <Plus className="h-3 w-3 mr-1" /> {p}
          </Button>
        ))}
      </div>
      {clip.keyframes.length > 0 && (
        <div className="space-y-1 mt-2">
          {clip.keyframes.map((kf) => (
            <div key={kf.id} className="flex items-center gap-2 text-[11px] rounded bg-background/40 px-2 py-1">
              <span className="font-mono text-muted-foreground">{formatTimecode(kf.time, 30, 'seconds')}</span>
              <span className="capitalize flex-1">{kf.property}</span>
              <span className="font-mono">{Math.round(kf.value * 100) / 100}</span>
              <Select value={kf.easing} onValueChange={(v) => update(clipId, { keyframes: clip.keyframes.map((k) => k.id === kf.id ? { ...k, easing: v as EasingType } : k) })}>
                <SelectTrigger className="h-6 w-20 text-[10px] bg-transparent border-0 px-1"><SelectValue /></SelectTrigger>
                <SelectContent>{['linear','ease-in','ease-out','ease-in-out','cubic'].map((e) => <SelectItem key={e} value={e} className="text-[11px]">{e}</SelectItem>)}</SelectContent>
              </Select>
              <button onClick={() => { pushHistory('Remove keyframe'); update(clipId, { keyframes: clip.keyframes.filter((k) => k.id !== kf.id) }); }} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// V19.1: Mask inspector UI — rectangle/circle/ellipse/polygon/freehand
function MaskSection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;

  const masks = clip.masks || [];
  const addMask = (kind: MaskShape['kind']) => {
    pushHistory('Add mask');
    const newMask: MaskShape = {
      id: `mask_${Date.now()}`,
      kind,
      feather: 0,
      opacity: 1,
      expansion: 0,
      x: 0.3,
      y: 0.3,
      width: 0.4,
      height: 0.4,
      invert: false,
      rotation: 0,
    };
    update(clipId, { masks: [...masks, newMask] });
  };
  const updateMask = (id: string, patch: Partial<MaskShape>) => {
    update(clipId, { masks: masks.map((m) => m.id === id ? { ...m, ...patch } : m) });
  };
  const removeMask = (id: string) => {
    pushHistory('Remove mask');
    update(clipId, { masks: masks.filter((m) => m.id !== id) });
  };

  return (
    <>
      <div className="grid grid-cols-5 gap-1 mb-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addMask('rectangle')}>Rect</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addMask('circle')}>Circle</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addMask('polygon')}>Poly</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addMask('freehand')}>Free</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addMask('ellipse')}>Ellipse</Button>
      </div>
      {masks.map((mask, i) => (
        <div key={mask.id} className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-2 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium capitalize">{mask.kind} {i + 1}</span>
            <button onClick={() => removeMask(mask.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <Row label="X">
            <MiniSlider value={mask.x} min={0} max={1} step={0.01} onChange={(v) => updateMask(mask.id, { x: v })} />
          </Row>
          <Row label="Y">
            <MiniSlider value={mask.y} min={0} max={1} step={0.01} onChange={(v) => updateMask(mask.id, { y: v })} />
          </Row>
          <Row label="Width">
            <MiniSlider value={mask.width} min={0.05} max={1} step={0.01} onChange={(v) => updateMask(mask.id, { width: v })} />
          </Row>
          <Row label="Height">
            <MiniSlider value={mask.height} min={0.05} max={1} step={0.01} onChange={(v) => updateMask(mask.id, { height: v })} />
          </Row>
          <Row label="Feather">
            <MiniSlider value={mask.feather} min={0} max={0.5} step={0.01} onChange={(v) => updateMask(mask.id, { feather: v })} />
          </Row>
          <Row label="Opacity">
            <MiniSlider value={mask.opacity} min={0} max={1} step={0.01} onChange={(v) => updateMask(mask.id, { opacity: v })} />
          </Row>
          <Row label="Rotation">
            <NumberInput value={mask.rotation || 0} onChange={(v) => updateMask(mask.id, { rotation: v })} step={1} min={0} max={360} suffix="°" />
          </Row>
          <Row label="Invert">
            <Switch checked={mask.invert || false} onCheckedChange={(v) => updateMask(mask.id, { invert: v })} />
          </Row>
        </div>
      ))}
    </>
  );
}

// V19.1: Chroma Key inspector UI — color/similarity/smoothness/spill/edge
function ChromaKeySection({ clipId }: { clipId: string }) {
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const update = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  if (!clip) return null;

  const ck = clip.chromaKey || { enabled: false, color: '#00FF00', similarity: 0.3, smoothness: 0.1, spillSuppression: 0.5, edgeSoftness: 0.1, shadowPreservation: 0.5 };
  const updateCK = (patch: Partial<typeof ck>) => {
    pushHistory('Update chroma key');
    update(clipId, { chromaKey: { ...ck, ...patch } });
  };

  return (
    <>
      <Row label="Enable">
        <Switch checked={ck.enabled} onCheckedChange={(v) => updateCK({ enabled: v })} />
      </Row>
      {ck.enabled && (
        <>
          <Row label="Key Color">
            <input
              type="color"
              value={ck.color}
              onChange={(e) => updateCK({ color: e.target.value })}
              className="h-7 w-12 rounded border border-border/40 bg-transparent cursor-pointer"
            />
          </Row>
          <Row label="Similarity">
            <MiniSlider value={ck.similarity} min={0} max={1} step={0.01} onChange={(v) => updateCK({ similarity: v })} />
          </Row>
          <Row label="Smoothness">
            <MiniSlider value={ck.smoothness} min={0} max={1} step={0.01} onChange={(v) => updateCK({ smoothness: v })} />
          </Row>
          <Row label="Spill Suppression">
            <MiniSlider value={ck.spillSuppression} min={0} max={1} step={0.01} onChange={(v) => updateCK({ spillSuppression: v })} />
          </Row>
          <Row label="Edge Softness">
            <MiniSlider value={ck.edgeSoftness} min={0} max={1} step={0.01} onChange={(v) => updateCK({ edgeSoftness: v })} />
          </Row>
          <Row label="Shadow Preservation">
            <MiniSlider value={ck.shadowPreservation} min={0} max={1} step={0.01} onChange={(v) => updateCK({ shadowPreservation: v })} />
          </Row>
        </>
      )}
    </>
  );
}
