'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Loader2, Smartphone, Square, Monitor, RectangleHorizontal, RectangleVertical, Film, Layout } from 'lucide-react';
import type { CanvasPreset, ResolutionPreset } from '@/lib/types';
import { CANVAS_DIMENSIONS, resolutionFor } from '@/lib/timeline';

const CANVAS_OPTIONS: { preset: CanvasPreset; icon: React.ElementType; label: string; sub: string }[] = [
  { preset: '16:9', icon: Monitor, label: '16:9', sub: 'YouTube / Landscape' },
  { preset: '9:16', icon: Smartphone, label: '9:16', sub: 'TikTok / Reels / Shorts' },
  { preset: '1:1', icon: Square, label: '1:1', sub: 'Instagram Square' },
  { preset: '4:5', icon: RectangleVertical, label: '4:5', sub: 'Instagram Portrait' },
  { preset: '4:3', icon: RectangleHorizontal, label: '4:3', sub: 'Classic' },
  { preset: '21:9', icon: Film, label: '21:9', sub: 'Cinematic' },
  { preset: 'custom', icon: Layout, label: 'Custom', sub: 'Your own size' },
];

const RESOLUTION_OPTIONS: ResolutionPreset[] = ['480p', '720p', '1080p', '1440p', '4K'];
const FPS_OPTIONS: (24 | 25 | 30 | 50 | 60)[] = [24, 25, 30, 50, 60];

const TEMPLATES = [
  { id: 'blank', name: 'Blank project', desc: 'Start from scratch', gradient: 'from-zinc-700 to-zinc-800' },
  { id: 'tiktok', name: 'TikTok viral', desc: '9:16 with captions', gradient: 'from-amber-600 to-rose-600' },
  { id: 'youtube', name: 'YouTube intro', desc: '16:9 with music', gradient: 'from-amber-600 to-orange-700' },
  { id: 'reel', name: 'Reel teaser', desc: '9:16 + transitions', gradient: 'from-amber-700 to-yellow-600' },
  { id: 'podcast', name: 'Podcast clip', desc: '16:9 + waveforms', gradient: 'from-emerald-700 to-teal-800' },
  { id: 'product', name: 'Product showcase', desc: '1:1 + text overlays', gradient: 'from-amber-800 to-stone-700' },
];

export function CreateProjectDialog() {
  const open = useUIStore((s) => s.createProjectOpen);
  const setOpen = useUIStore((s) => s.setCreateProjectOpen);
  const openProject = useUIStore((s) => s.openProject);
  const setView = useUIStore((s) => s.setView);
  const refreshProjects = useAuthStore((s) => s.refresh);

  const [name, setName] = useState('Untitled project');
  const [canvasPreset, setCanvasPreset] = useState<CanvasPreset>('16:9');
  const [resolution, setResolution] = useState<ResolutionPreset>('1080p');
  const [fps, setFps] = useState<24 | 25 | 30 | 50 | 60>(30);
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [creating, setCreating] = useState(false);

  // React to "new" action
  const pendingAction = useUIStore((s) => s.pendingAction);
  useEffect(() => {
    if (pendingAction === 'new') {
      useUIStore.setState({ pendingAction: null, createProjectOpen: true });
    }
  }, [pendingAction]);

  function reset() {
    setName('Untitled project');
    setCanvasPreset('16:9');
    setResolution('1080p');
    setFps(30);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || 'Untitled project',
        canvasPreset,
        resolution,
        fps,
      };
      if (canvasPreset === 'custom') {
        body.customWidth = customWidth;
        body.customHeight = customHeight;
      }
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      toast.success('Project created');
      await refreshProjects();
      reset();
      setOpen(false);
      useEditorStore.getState().reset();
      openProject(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  const dims =
    canvasPreset === 'custom'
      ? { width: customWidth, height: customHeight }
      : resolutionFor(canvasPreset, resolution);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogContent className="max-w-4xl bg-card/95 backdrop-blur-xl border-border/60 p-0 gap-0 max-h-[90vh] overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="text-lg">Create a new project</DialogTitle>
          <DialogDescription className="text-sm">
            Pick a format, resolution, and frame rate. You can change these later.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="px-6 py-5 space-y-7">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="proj-name">Project name</Label>
              <Input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Untitled project"
                className="bg-background/60"
              />
            </div>

            {/* Canvas presets */}
            <div className="space-y-2.5">
              <Label>Canvas</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {CANVAS_OPTIONS.map(({ preset, icon: Icon, label, sub }) => {
                  const active = canvasPreset === preset;
                  return (
                    <button
                      key={preset}
                      onClick={() => setCanvasPreset(preset)}
                      className={`group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition ${
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                          : 'border-border/60 bg-background/40 hover:border-border hover:bg-accent/40'
                      }`}
                    >
                      <div className={`flex items-center justify-center rounded-md h-12 w-full ${active ? 'bg-primary/15' : 'bg-muted/40'}`}>
                        <Icon className={`h-5 w-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <div className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight">{sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {canvasPreset === 'custom' && (
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Width</Label>
                    <Input
                      type="number"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Math.max(16, parseInt(e.target.value) || 0))}
                      className="w-28 bg-background/60"
                      min={16}
                      step={2}
                    />
                  </div>
                  <span className="text-muted-foreground">×</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Height</Label>
                    <Input
                      type="number"
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Math.max(16, parseInt(e.target.value) || 0))}
                      className="w-28 bg-background/60"
                      min={16}
                      step={2}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Resolution */}
            <div className="space-y-2.5">
              <Label>Resolution</Label>
              <div className="flex flex-wrap gap-2">
                {RESOLUTION_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={`px-3.5 py-1.5 rounded-md text-sm font-medium border transition ${
                      resolution === r
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame rate */}
            <div className="space-y-2.5">
              <Label>Frame rate</Label>
              <div className="flex flex-wrap gap-2">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={`px-3.5 py-1.5 rounded-md text-sm font-medium border transition ${
                      fps === f
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Templates (visual) */}
            <div className="space-y-2.5">
              <Label>Start from a template <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.id !== 'blank') {
                        if (t.id === 'tiktok' || t.id === 'reel') setCanvasPreset('9:16');
                        if (t.id === 'youtube' || t.id === 'podcast') setCanvasPreset('16:9');
                        if (t.id === 'product') setCanvasPreset('1:1');
                        setName(t.name);
                      } else {
                        setName('Untitled project');
                      }
                    }}
                    className="group relative overflow-hidden rounded-lg border border-border/60 h-20 text-left"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${t.gradient} opacity-80`} />
                    <div className="absolute inset-0 bg-grid-sm opacity-30" />
                    <div className="relative h-full p-2.5 flex flex-col justify-end">
                      <div className="text-xs font-semibold text-white drop-shadow">{t.name}</div>
                      <div className="text-[10px] text-white/80">{t.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground flex items-center justify-between">
              <span>Output:</span>
              <span className="text-foreground font-medium font-mono">
                {dims.width} × {dims.height} · {fps}fps · {resolution}
              </span>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-border/50 bg-background/30">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating} className="min-w-32">
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
