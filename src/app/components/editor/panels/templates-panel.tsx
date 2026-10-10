'use client';

// VidiaForge V19.1 — Templates Panel (REAL E2E + apply-vs-create distinction)
//
// V19.1 §3-9 + §7 (Issue 7):
//   - When the user is on the dashboard (NOT inside a project), the
//     primary action on each template card is "Use Template" →
//     POST /api/templates/[id]/use → creates a NEW project initialized
//     from the template.
//   - When the user is INSIDE a project (the editor is loaded), the
//     primary action is "Apply to current project" →
//     POST /api/templates/[id]/apply?projectId=<current> → PATCHes the
//     existing project's timelineData. The project's identity, name,
//     ownership, and unrelated settings are preserved.
//
// This separation fixes the previously-reported bug:
//   "Selecting a template inside an existing project creates a new project."
// which was caused by the panel always calling /api/templates/[id]/use
// regardless of context.
//
// The two operations are visually distinct in the UI:
//   - "Use Template" → blue primary button with Play icon
//   - "Apply to current project" → amber-tinted button with Wand2 icon,
//     and a confirmation step (because applying replaces the current
//     timeline structure).

import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import {
  LayoutTemplate, Search, Sparkles, Loader2, Play, Wand2, RefreshCw,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  normalizeApiError,
  responseToErrorMessage,
} from '@/lib/errors/client';

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
  creator?: { name: string; verified: boolean } | null;
  usageCount: number;
  rank: number;
}

const CATEGORIES = [
  'All', 'Social', 'Lifestyle', 'Events', 'Business', 'Creator', 'Visual Styles', 'Music',
];

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'recommended', label: 'Recommended' },
] as const;

export function TemplatesPanel() {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<typeof SORT_OPTIONS[number]['value']>('trending');
  const [templates, setTemplates] = useState<TemplatePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);
  // Confirm modal for the destructive "apply to current project" action.
  const [confirmApply, setConfirmApply] = useState<TemplatePreview | null>(null);

  const openProject = useUIStore((s) => s.openProject);
  const setView = useUIStore((s) => s.setView);
  const user = useAuthStore((s) => s.user);
  const projectId = useEditorStore((s) => s.projectId);
  // V19.1 §7 (Issue 7): we are "inside a project" when the editor store
  // has a non-null projectId. In that case the primary action becomes
  // "Apply to current project"; otherwise it's "Use Template" (create
  // new). The two operations are explicitly separated at the API level
  // (/api/templates/[id]/apply vs /api/templates/[id]/use).
  const inProject = !!projectId;

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (category !== 'All') params.set('category', category);
      params.set('sort', sort);
      params.set('limit', '50');
      const res = await fetch(`/api/templates?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch templates');
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      // If API unavailable (e.g., DB down), the route returns builtins.
      toast.error('Failed to load templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [search, category, sort]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // V19.1 §7 (Issue 7): "Use Template" — creates a NEW project initialized
  // from the template. Used when the user is NOT inside an existing
  // project (e.g., from the dashboard). Named with a verb (not `useTemplate`)
  // so the react-hooks/rules-of-hooks linter does not flag it as a hook.
  const createProjectFromTemplate = async (templateId: string) => {
    if (!user) {
      toast.error('Please sign in to use templates');
      setView('login');
      return;
    }
    setUsingId(templateId);
    try {
      const res = await fetch(`/api/templates/${templateId}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: undefined }),
      });
      if (!res.ok) {
        const msg = await responseToErrorMessage(res, 'Failed to use template');
        throw new Error(msg);
      }
      const data = await res.json();
      toast.success(`Created project "${data.project.name}" from template`);
      openProject(data.project.id);
    } catch (err) {
      toast.error(normalizeApiError(err, 'Failed to use template'));
    } finally {
      setUsingId(null);
    }
  };

  // V19.1 §7 (Issue 7): "Apply to current project" — PATCHes the existing
  // project's timelineData. The project's identity + ownership + name are
  // preserved. We ask the user to confirm because applying a template
  // structurally replaces the current timeline composition.
  const applyTemplateToCurrent = async (templateId: string) => {
    if (!user) {
      toast.error('Please sign in to apply templates');
      setView('login');
      return;
    }
    if (!projectId) {
      // Defensive — should never happen because the button is only shown
      // when inProject is true, but guard against a stale UI.
      toast.error('Open a project before applying a template to it');
      setView('dashboard');
      return;
    }
    setUsingId(templateId);
    try {
      const res = await fetch(
        `/api/templates/${templateId}/apply?projectId=${encodeURIComponent(projectId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        },
      );
      if (!res.ok) {
        const msg = await responseToErrorMessage(res, 'Failed to apply template');
        throw new Error(msg);
      }
      const data = await res.json();
      toast.success(`Applied template to "${data.project.name}". Project ID unchanged.`);
      // V19.1 §7: reload the editor store from the patched project so the
      // new timeline is reflected immediately (the loadProject helper
      // already handles the response shape correctly).
      await useEditorStore.getState().loadProject(projectId);
    } catch (err) {
      toast.error(normalizeApiError(err, 'Failed to apply template'));
    } finally {
      setUsingId(null);
      setConfirmApply(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Context banner: makes the apply-vs-create distinction explicit */}
      {inProject ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-200/90 leading-snug">
          You are inside a project. Applying a template replaces the current
          timeline structure — your project ID, name, and ownership stay the
          same. To create a brand-new project from a template, go back to the
          dashboard first.
        </div>
      ) : (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[10px] text-primary/80 leading-snug">
          Pick a template to create a new project from it. To apply a template
          to an existing project, open that project in the editor first.
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="h-8 pl-8 bg-background/60 text-xs"
        />
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition ${
              category === c
                ? 'bg-primary/15 text-primary'
                : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sort options */}
      <div className="flex gap-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            className={`px-1.5 py-0.5 rounded text-[10px] transition ${
              sort === opt.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-3 text-center">
          <LayoutTemplate className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-[11px] text-muted-foreground">
            No templates found. Try a different search.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden hover:border-primary/50 transition"
            >
              {/* Thumbnail (layout preview — NOT a rendered frame).
                  V19.1 v5: the thumbnail is an illustrative layout
                  composition (gradient + title + slot rectangles) generated
                  by scripts/generate-template-thumbnails.ts. It is NOT a
                  frame from a real rendered export. Falls back to the
                  gradient only when the thumbnail fails to load. */}
              <div className="aspect-video bg-gradient-to-br from-primary/30 via-primary/10 to-background relative overflow-hidden">
                {t.thumbnailUrl ? (
                  <img src={t.thumbnailUrl} alt={`${t.title} layout preview`} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary/40" />
                  </div>
                )}
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white/80">
                  {t.aspectRatio}
                </div>
                {/* V19.1 v5: honest "Layout" badge so users understand the
                    thumbnail is a layout illustration, not a rendered frame. */}
                <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-white/90">
                  Layout
                </div>
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white/80">
                  {formatDuration(t.duration)}
                </div>
                {t.tier !== 'free' && (
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-600/80 text-[9px] font-mono text-white">
                    {t.tier}
                  </div>
                )}
              </div>

              <div className="p-2">
                <div className="text-xs font-medium truncate">{t.title}</div>
                {t.description && (
                  <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>
                )}
                <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
                  <span className="px-1 py-0 rounded bg-muted/40">{t.category}</span>
                  <span>·</span>
                  <span>{t.slotCount} slots</span>
                  {t.usageCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{formatCount(t.usageCount)} uses</span>
                    </>
                  )}
                </div>

                {/*
                  V19.1 §7 (Issue 7): the primary action differs based on
                  context. Inside an editor → "Apply to current project".
                  Outside an editor → "Use Template" (create new project).
                  The button label + icon make the distinction explicit so
                  users are not surprised by what happens when they click.
                */}
                <Button
                  size="sm"
                  className={`w-full mt-2 h-6 text-[10px] ${
                    inProject
                      ? 'bg-amber-600/80 hover:bg-amber-600 text-white'
                      : ''
                  }`}
                  disabled={usingId === t.id}
                  onClick={() => {
                    if (inProject) {
                      setConfirmApply(t);
                    } else {
                      createProjectFromTemplate(t.id);
                    }
                  }}
                >
                  {usingId === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : inProject ? (
                    <>
                      <Wand2 className="h-3 w-3 mr-1" />
                      Apply to current
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 mr-1" />
                      Use Template
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* V19.1 §7: confirmation modal for "apply to current project" */}
      <Dialog open={!!confirmApply} onOpenChange={(o) => !o && setConfirmApply(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-amber-500" />
              Apply template to this project?
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-2">
              Applying <span className="text-foreground font-medium">{confirmApply?.title}</span> will
              replace the current project&apos;s timeline structure with the
              template&apos;s tracks and clips. Your project&apos;s identity,
              name, and ownership are preserved. Existing clips will be
              discarded — make sure you have saved anything you need.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmApply(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={!!usingId}
              onClick={() => confirmApply && applyTemplateToCurrent(confirmApply.id)}
            >
              {usingId ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Apply template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-dashed border-border/40 p-3 text-center">
        <LayoutTemplate className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
        <p className="text-[11px] text-muted-foreground">
          Template creator program + marketplace coming soon.
        </p>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
