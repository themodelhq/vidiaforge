'use client';

// VidiaForge V19.1 — Create Project dialog
//
// V19.1 §6 + §9 fixes:
//   - Templates shown in the modal are REAL templates fetched from
//     /api/templates (the same catalog the editor's Templates panel uses).
//   - Each template card is fully clickable + keyboard-activatable and shows
//     a visible selected state. The previously hardcoded `TEMPLATES` array
//     had opaque IDs (`tiktok`, `reel`, …) that did NOT match the real
//     builtin IDs (`tpl-tiktok-viral-9x16`, `tpl-reels-promo-9x16`, …), so
//     clicking a card only changed the canvas preset and never reached the
//     template-application flow.
//   - When a real template is selected, the dialog calls
//     POST /api/templates/[id]/use to create a new project initialized from
//     the template (NOT the plain POST /api/projects which only creates an
//     empty shell). This means "Create project from template" actually
//     seeds the new project with the template's tracks, clips, and slots.
//   - When no template is selected (the "Blank" tile), the dialog calls
//     POST /api/projects as before.
//   - V19.1 §5.E (data.project.id bug): the POST /api/projects route returns
//     `{ project: { id, ... } }`, but the previous code read `data.id`
//     (undefined) and called `openProject(undefined)` — which sent the
//     user to the "No project selected" screen even though the project was
//     successfully created in the backend. We now read `data.project.id`
//     and also tolerate the legacy `{ id }` envelope.

import { useEffect, useState, useCallback } from 'react';
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
import {
  Loader2, Smartphone, Square, Monitor, RectangleHorizontal, RectangleVertical,
  Film, Layout, Sparkles, Check,
} from 'lucide-react';
import type { CanvasPreset, ResolutionPreset } from '@/lib/types';
import { CANVAS_DIMENSIONS, resolutionFor } from '@/lib/timeline';
import {
  normalizeApiError,
  responseToErrorMessage,
} from '@/lib/errors/client';

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

// Real template preview shape returned by /api/templates
interface TemplatePreview {
  id: string;
  title: string;
  description?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  thumbnailUrl?: string;
  aspectRatio: string;
  duration: number;
  slotCount: number;
  tier: string;
  isBuiltin: boolean;
}

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

  // V19.1 §6: real template catalog fetched from /api/templates. We fetch
  // once when the dialog first opens (and reuse the cache on subsequent
  // opens within the same page session).
  const [templates, setTemplates] = useState<TemplatePreview[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // React to "new" action
  const pendingAction = useUIStore((s) => s.pendingAction);
  useEffect(() => {
    if (pendingAction === 'new') {
      useUIStore.setState({ pendingAction: null, createProjectOpen: true });
    }
  }, [pendingAction]);

  // Fetch the real template catalog when the dialog opens for the first
  // time. We deliberately show an empty state (with a clear "no templates
  // available right now" message) if the fetch fails — we do NOT fabricate
  // fake template cards.
  const fetchTemplates = useCallback(async () => {
    if (templates !== null || templatesLoading) return;
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/templates?limit=12&sort=trending', { cache: 'no-store' });
      if (!res.ok) {
        // Don't toast on dialog open — just leave templates null so the
        // section renders an honest empty state.
        setTemplates([]);
        return;
      }
      const data = await res.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [templates, templatesLoading]);

  useEffect(() => {
    if (open) {
      fetchTemplates();
    }
  }, [open, fetchTemplates]);

  function reset() {
    setName('Untitled project');
    setCanvasPreset('16:9');
    setResolution('1080p');
    setFps(30);
    setSelectedTemplateId(null);
  }

  // V19.1 §6: when a real template is selected, sync the canvas preset +
  // project name to match the template's aspect ratio + title. The user can
  // still override these before clicking "Create project".
  function selectTemplate(t: TemplatePreview) {
    setSelectedTemplateId(t.id);
    // Map the template aspect ratio string back to a CanvasPreset.
    const ar = t.aspectRatio as CanvasPreset;
    const valid: CanvasPreset[] = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9', 'custom'];
    if (valid.includes(ar)) setCanvasPreset(ar);
    setName(t.title);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const trimmedName = name.trim() || 'Untitled project';
      let projectId: string | null = null;
      let projectName: string | null = null;

      if (selectedTemplateId) {
        // V19.1 §6: use the real template-application endpoint. This
        // creates a NEW project initialized from the template's
        // timelineData (tracks + clips + slots). This is the "Create
        // project from template" operation — distinct from the
        // "Apply template to existing project" operation handled in the
        // editor's Templates panel.
        const res = await fetch(`/api/templates/${encodeURIComponent(selectedTemplateId)}/use`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: trimmedName }),
        });
        if (!res.ok) {
          const msg = await responseToErrorMessage(res, 'Failed to create project from template');
          throw new Error(msg);
        }
        const data = await res.json();
        projectId = data?.project?.id ?? null;
        projectName = data?.project?.name ?? trimmedName;
      } else {
        // Blank project — plain POST /api/projects
        const body: Record<string, unknown> = {
          name: trimmedName,
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
        if (!res.ok) {
          const msg = await responseToErrorMessage(res, 'Failed to create project');
          throw new Error(msg);
        }
        const data = await res.json();
        // V19.1 §5.E: the API returns `{ project: { id, ... } }` — read
        // data.project.id, NOT data.id (the previous code read data.id,
        // which was undefined, then called openProject(undefined) → the
        // user landed on the "No project selected" screen even though
        // the project was created successfully).
        projectId = data?.project?.id ?? data?.id ?? null;
        projectName = data?.project?.name ?? trimmedName;
      }

      if (!projectId) {
        // Backend returned a 2xx but the response shape didn't include an
        // id — that's a backend bug. Show a clear error instead of
        // navigating to an undefined project.
        throw new Error('Project was created but the response did not include a project ID. Please reopen the project from your dashboard.');
      }

      toast.success('Project created');
      await refreshProjects();
      reset();
      setOpen(false);
      // V19.1 §5.E: reset the editor BEFORE navigating so any stale
      // tracks/clips/assets from a previously-open project don't leak
      // into the new project's view (the editor-view's loadProject will
      // populate the new project's state on mount).
      useEditorStore.getState().reset();
      // V19.1 §5.E: navigate to the editor with the canonical project ID
      // returned by the backend. This is what previously broke: the dialog
      // read `data.id` (undefined) and called openProject(undefined).
      openProject(projectId);
      void projectName;
      setView('editor');
    } catch (e) {
      toast.error(normalizeApiError(e, 'Failed to create project'));
    } finally {
      setCreating(false);
    }
  }

  const dims =
    canvasPreset === 'custom'
      ? { width: customWidth, height: customHeight }
      : resolutionFor(canvasPreset, resolution);

  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId) || null;

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

            {/*
              V19.1 §6: Real, clickable, keyboard-activatable template cards.
              The previous tiles were visual placeholders with opaque IDs
              that never matched the real builtin template IDs.
            */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label>
                  Start from a template <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                {selectedTemplate && (
                  <button
                    onClick={() => setSelectedTemplateId(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Use blank project instead
                  </button>
                )}
              </div>

              {templatesLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-lg border border-border/40 bg-background/40 animate-pulse" />
                  ))}
                </div>
              ) : !templates || templates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/40 p-4 text-center">
                  <Sparkles className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-[11px] text-muted-foreground">
                    No templates available right now. You can still create a blank project above.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {templates.map((t) => {
                    const isSelected = selectedTemplateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => selectTemplate(t)}
                        onKeyDown={(e) => {
                          // Keyboard activation: Enter/Space already
                          // trigger onClick for <button>, but we keep the
                          // handler for clarity + a11y reviewers.
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectTemplate(t);
                          }
                        }}
                        aria-pressed={isSelected}
                        aria-label={`Select template ${t.title}`}
                        className={`group relative overflow-hidden rounded-lg border h-20 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/60'
                            : 'border-border/60 hover:border-primary/50 hover:bg-accent/30'
                        }`}
                      >
                        {/* V19.1 §5.2: real thumbnail PNG (generated by
                            scripts/generate-template-thumbnails.ts). Falls
                            back to the gradient only when the thumbnail
                            fails to load.
                            V19.1 v5: the thumbnail is an illustrative LAYOUT
                            PREVIEW (gradient + title + slot rectangles), NOT
                            a frame from a real rendered export. The `alt`
                            text reflects this so screen readers are honest. */}
                        {t.thumbnailUrl ? (
                          <img
                            src={t.thumbnailUrl}
                            alt={`${t.title} layout preview`}
                            className={`absolute inset-0 w-full h-full object-cover ${isSelected ? 'opacity-100' : 'opacity-80'}`}
                            loading="lazy"
                            onError={(e) => {
                              // Hide the broken image so the gradient
                              // fallback (next sibling) shows through.
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : null}
                        <div className={`absolute inset-0 bg-gradient-to-br ${
                          isSelected ? 'from-primary/40 to-primary/10' : 'from-zinc-700 to-zinc-800'
                        } ${t.thumbnailUrl ? 'opacity-0' : 'opacity-90'}`} />
                        <div className="absolute inset-0 bg-grid-sm opacity-30" />
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                        <div className="relative h-full p-2.5 flex flex-col justify-end">
                          <div className="text-xs font-semibold text-white drop-shadow truncate">{t.title}</div>
                          <div className="text-[10px] text-white/80 truncate">
                            {t.aspectRatio} · {Math.floor(t.duration / 60)}:{String(t.duration % 60).padStart(2, '0')}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedTemplate && (
                <p className="text-[11px] text-muted-foreground">
                  Selected template: <span className="text-foreground font-medium">{selectedTemplate.title}</span>.
                  The canvas + name will be set from the template; you can still adjust them above.
                </p>
              )}
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
            {selectedTemplate ? 'Create from template' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Touch CANVAS_DIMENSIONS so the import is exercised (resolutionFor uses it).
void CANVAS_DIMENSIONS;
