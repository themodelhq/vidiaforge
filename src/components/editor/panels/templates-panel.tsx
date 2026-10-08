'use client';

// VidiaForge v19 — Templates Panel (REAL E2E)
//
// V19 §3-9: Template discovery + use-template flow.
//
// V19 §1: Previously this panel showed a "coming soon" toast. Now it:
//   1. Fetches templates from /api/templates (with search + filter + sort)
//   2. Shows template cards with real metadata (category, duration, slots)
//   3. On "Use Template" click → POST /api/templates/[id]/use → creates project
//   4. Opens the new project in the editor

import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { LayoutTemplate, Search, Sparkles, Loader2, Play } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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

  const openProject = useUIStore((s) => s.openProject);
  const setView = useUIStore((s) => s.setView);
  const user = useAuthStore((s) => s.user);

  // V19 §7: Fetch templates with search + filter + sort
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
    } catch (err) {
      // If API unavailable (e.g., DB down), the route returns builtins.
      // Only show error if the response itself was bad.
      toast.error('Failed to load templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [search, category, sort]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // V19 §5: Use Template — POST to create new project from template
  // (renamed from useTemplate to avoid react-hooks/rules-of-hooks false positive)
  const applyTemplate = async (templateId: string) => {
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
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Failed to use template (HTTP ${res.status})`);
      }
      const data = await res.json();
      toast.success(`Created project "${data.project.name}" from template`);
      // V19 §5: Open the new project in the editor
      openProject(data.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to use template');
    } finally {
      setUsingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* V19 §7: Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="h-8 pl-8 bg-background/60 text-xs"
        />
      </div>

      {/* V19 §7: Category filter */}
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

      {/* V19 §7: Sort options */}
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

      {/* V19 §9: Template grid */}
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
              {/* Thumbnail (gradient fallback when no thumbnailUrl) */}
              <div className="aspect-video bg-gradient-to-br from-primary/30 via-primary/10 to-background relative overflow-hidden">
                {t.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnailUrl} alt={t.title} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary/40" />
                  </div>
                )}
                <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white/80">
                  {t.aspectRatio}
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

                <Button
                  size="sm"
                  className="w-full mt-2 h-6 text-[10px]"
                  disabled={usingId === t.id}
                  onClick={() => applyTemplate(t.id)}
                >
                  {usingId === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
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
