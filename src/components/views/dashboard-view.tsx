'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, Search, MoreVertical, Star, Copy, Trash2, Pencil, Download, Share2,
  Clock, Film, Smartphone, Monitor, Grid3x3, List, Loader2, Settings as SettingsIcon,
  LogOut, UploadCloud, FolderOpen, LayoutGrid, Sparkles, HardDrive, Clock3
} from 'lucide-react';
import { formatDuration, formatBytes } from '@/lib/timeline';
import type { ProjectMeta } from '@/lib/types';

export function DashboardView() {
  const setView = useUIStore((s) => s.setView);
  const openProject = useUIStore((s) => s.openProject);
  const setCreateProjectOpen = useUIStore((s) => s.setCreateProjectOpen);
  const setExportDialogOpen = useUIStore((s) => s.setExportDialogOpen);
  const setShareDialogOpen = useUIStore((s) => s.setShareDialogOpen);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [view, setLayout] = useState<'grid' | 'list'>('grid');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<ProjectMeta[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      const data = await res.json();
      return data.projects ?? [];
    },
  });

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const favorites = filtered.filter((p) => p.favorite);
  const recent = filtered.filter((p) => !p.favorite);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project deleted');
      setDeleteId(null);
    },
    onError: () => toast.error('Failed to delete project'),
  });

  const toggleFavorite = useCallback(async (p: ProjectMeta) => {
    try {
      await fetch(`/api/projects/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !p.favorite }),
      });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch {
      toast.error('Failed to update');
    }
  }, [queryClient]);

  const duplicateProject = useCallback(async (p: ProjectMeta) => {
    try {
      const res = await fetch(`/api/projects/${p.id}/duplicate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to duplicate');
      toast.success('Project duplicated');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch {
      toast.error('Failed to duplicate project');
    }
  }, [queryClient]);

  const renameProject = useCallback(async () => {
    if (!renameId) return;
    try {
      await fetch(`/api/projects/${renameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() || 'Untitled' }),
      });
      toast.success('Project renamed');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setRenameId(null);
    } catch {
      toast.error('Failed to rename project');
    }
  }, [renameId, renameValue, queryClient]);

  const initials = (user?.name || user?.email || 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border/50 glass">
        <div className="flex h-14 items-center px-4 sm:px-6 gap-3">
          <button onClick={() => setView('landing')} className="flex items-center gap-2.5 shrink-0">
            <div className="h-7 w-7 rounded-md overflow-hidden ring-1 ring-primary/30">
              <svg viewBox="0 0 512 512" className="h-full w-full">
                <defs>
                  <linearGradient id="db" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#f5a623" />
                    <stop offset="100%" stopColor="#e07b1a" />
                  </linearGradient>
                </defs>
                <rect width="512" height="512" fill="#0a0a0f" />
                <circle cx="256" cy="256" r="140" fill="none" stroke="url(#db)" strokeWidth="14" opacity="0.9" />
                <path d="M 204 178 L 348 256 L 204 334 Z" fill="url(#db)" />
              </svg>
            </div>
            <span className="font-semibold tracking-tight hidden sm:block">VidiaForge</span>
          </button>

          <div className="flex-1" />

          <Button variant="ghost" size="sm" onClick={() => setView('landing')} className="hidden sm:flex">
            Home
          </Button>

          <Button variant="ghost" size="sm" className="hidden sm:flex">
            <HardDrive className="h-4 w-4 mr-1.5" />
            Storage
          </Button>

          <Button variant="ghost" size="sm" onClick={() => useUIStore.getState().setSettingsDialogOpen(true)}>
            <SettingsIcon className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Settings</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-accent transition">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/15 text-primary text-xs font-medium">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm hidden sm:block max-w-32 truncate">{user?.name || user?.email}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{user?.name || 'Creator'}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                <Badge variant="secondary" className="mt-1.5 capitalize text-[10px]">{user?.plan || 'free'} plan</Badge>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => useUIStore.getState().setSettingsDialogOpen(true)}>
                <SettingsIcon className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { await logout(); setView('landing'); }}>
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          {/* Greeting + actions */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Pick up where you left off, or start something new.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => toast.info('Import a .vfproject file — coming soon')}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Import
              </Button>
              <Button onClick={() => setCreateProjectOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New project
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard icon={Film} label="Projects" value={String(projects.length)} />
            <StatCard icon={Star} label="Favorites" value={String(projects.filter((p) => p.favorite).length)} />
            <StatCard icon={Clock3} label="Total runtime" value={formatDuration(projects.reduce((a, p) => a + p.duration, 0))} />
            <StatCard icon={Sparkles} label="Plan" value={(user?.plan || 'free') + ' plan'} />
          </div>

          {/* Search + layout toggle */}
          <div className="flex items-center gap-2 mb-5">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="pl-9 bg-card/60"
              />
            </div>
            <div className="flex rounded-md border border-border/60 bg-card/40 p-0.5">
              <button
                onClick={() => setLayout('grid')}
                className={`p-1.5 rounded ${view === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setLayout('list')}
                className={`p-1.5 rounded ${view === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Empty state */}
          {!isLoading && projects.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Film className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium">Your studio is empty.</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                Create your first project to start editing. Choose a format, drop in your media, and let the timeline do the rest.
              </p>
              <div className="flex items-center justify-center gap-2 mt-5">
                <Button onClick={() => setCreateProjectOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New project
                </Button>
                <Button variant="outline" onClick={() => toast.info('Demo project coming soon')}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Try demo project
                </Button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="p-0 overflow-hidden animate-pulse">
                  <div className="aspect-video bg-muted/40" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-muted/40 rounded w-2/3" />
                    <div className="h-2 bg-muted/30 rounded w-1/3" />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Favorites */}
          {favorites.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5" /> Favorites
              </h2>
              <ProjectGrid
                projects={favorites}
                view={view}
                onOpen={openProject}
                onFavorite={toggleFavorite}
                onDuplicate={duplicateProject}
                onRename={(p) => { setRenameId(p.id); setRenameValue(p.name); }}
                onDelete={(p) => setDeleteId(p.id)}
                onExport={() => setExportDialogOpen(true)}
                onShare={() => setShareDialogOpen(true)}
              />
            </section>
          )}

          {/* Recent */}
          {recent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Recent projects
              </h2>
              <ProjectGrid
                projects={recent}
                view={view}
                onOpen={openProject}
                onFavorite={toggleFavorite}
                onDuplicate={duplicateProject}
                onRename={(p) => { setRenameId(p.id); setRenameValue(p.name); }}
                onDelete={(p) => setDeleteId(p.id)}
                onExport={() => setExportDialogOpen(true)}
                onShare={() => setShareDialogOpen(true)}
              />
            </section>
          )}
        </div>
      </main>

      {/* Rename dialog */}
      <Dialog open={!!renameId} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Project name"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') renameProject(); }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button onClick={renameProject}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the project and all its timeline data. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-semibold truncate">{value}</div>
    </Card>
  );
}

interface ProjectGridProps {
  projects: ProjectMeta[];
  view: 'grid' | 'list';
  onOpen: (id: string) => void;
  onFavorite: (p: ProjectMeta) => void;
  onDuplicate: (p: ProjectMeta) => void;
  onRename: (p: ProjectMeta) => void;
  onDelete: (p: ProjectMeta) => void;
  onExport: () => void;
  onShare: () => void;
}

function ProjectGrid(props: ProjectGridProps) {
  if (props.view === 'list') {
    return (
      <div className="space-y-2">
        {props.projects.map((p) => (
          <ProjectRow key={p.id} project={p} {...props} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {props.projects.map((p) => (
        <ProjectCard key={p.id} project={p} {...props} />
      ))}
    </div>
  );
}

function ProjectCard({ project, onOpen, onFavorite, onDuplicate, onRename, onDelete, onExport, onShare }: ProjectGridProps & { project: ProjectMeta }) {
  const isVertical = project.height > project.width;
  return (
    <Card className="group p-0 overflow-hidden bg-card/50 border-border/50 hover:border-border transition cursor-pointer">
      <div
        className="relative aspect-video bg-gradient-to-br from-zinc-800 via-zinc-900 to-black overflow-hidden"
        onClick={() => onOpen(project.id)}
      >
        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.thumbnailUrl} alt={project.name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-grid-sm opacity-30 flex items-center justify-center">
            <div className={`relative ${isVertical ? 'h-3/4 aspect-[9/16]' : 'h-2/3 aspect-video'} rounded border border-white/10 bg-black/40`}>
              <div className="absolute inset-0 flex items-center justify-center">
                <Film className="h-6 w-6 text-white/30" />
              </div>
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge variant="secondary" className="bg-black/60 backdrop-blur text-[10px] font-mono">
            {project.canvasPreset}
          </Badge>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onFavorite(project); }}
          className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-black/80 transition"
          aria-label="Favorite"
        >
          <Star className={`h-3.5 w-3.5 ${project.favorite ? 'fill-primary text-primary' : 'text-white/70'}`} />
        </button>
        <div className="absolute bottom-2 right-2">
          <Badge variant="secondary" className="bg-black/60 backdrop-blur text-[10px] font-mono">
            {formatDuration(project.duration)}
          </Badge>
        </div>
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <Button size="sm" variant="secondary">Open editor</Button>
        </div>
      </div>
      <div className="p-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium truncate" onClick={() => onOpen(project.id)}>{project.name}</h3>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{project.width}×{project.height}</span>
            <span>·</span>
            <span>{project.fps}fps</span>
            <span>·</span>
            <span>{timeAgo(project.lastOpenedAt)}</span>
          </div>
        </div>
        <ProjectMenu
          onOpen={() => onOpen(project.id)}
          onRename={() => onRename(project)}
          onDuplicate={() => onDuplicate(project)}
          onDelete={() => onDelete(project)}
          onExport={onExport}
          onShare={onShare}
        />
      </div>
    </Card>
  );
}

function ProjectRow({ project, onOpen, onFavorite, onDuplicate, onRename, onDelete, onExport, onShare }: ProjectGridProps & { project: ProjectMeta }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/40 hover:bg-card/70 transition">
      <button onClick={() => onFavorite(project)} className="shrink-0">
        <Star className={`h-4 w-4 ${project.favorite ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
      </button>
      <div className="h-10 w-16 rounded bg-gradient-to-br from-zinc-800 to-black overflow-hidden flex items-center justify-center shrink-0 cursor-pointer" onClick={() => onOpen(project.id)}>
        <Film className="h-4 w-4 text-white/30" />
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(project.id)}>
        <h3 className="text-sm font-medium truncate">{project.name}</h3>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{project.width}×{project.height}</span>
          <span>·</span>
          <span>{project.fps}fps</span>
          <span>·</span>
          <span>{formatDuration(project.duration)}</span>
          <span>·</span>
          <span>{timeAgo(project.lastOpenedAt)}</span>
        </div>
      </div>
      <ProjectMenu
        onOpen={() => onOpen(project.id)}
        onRename={() => onRename(project)}
        onDuplicate={() => onDuplicate(project)}
        onDelete={() => onDelete(project)}
        onExport={onExport}
        onShare={onShare}
      />
    </div>
  );
}

function ProjectMenu({ onOpen, onRename, onDuplicate, onDelete, onExport, onShare }: {
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onShare: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent transition" aria-label="More actions">
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onOpen}>
          <FolderOpen className="h-4 w-4 mr-2" /> Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4 mr-2" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <Copy className="h-4 w-4 mr-2" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExport}>
          <Download className="h-4 w-4 mr-2" /> Export
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare}>
          <Share2 className="h-4 w-4 mr-2" /> Share
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function timeAgo(iso: string): string {
  const date = new Date(iso);
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return date.toLocaleDateString();
}
