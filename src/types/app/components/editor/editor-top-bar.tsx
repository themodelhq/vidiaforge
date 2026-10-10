'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft, Undo2, Redo2, Download, Share2, Settings as SettingsIcon,
  Sparkles, Cloud, CloudOff, RefreshCw, Save, ChevronDown, LogOut, Keyboard, Check, Loader2,
} from 'lucide-react';

export function EditorTopBar() {
  const openDashboard = useUIStore((s) => s.openDashboard);
  const setExportDialogOpen = useUIStore((s) => s.setExportDialogOpen);
  const setShareDialogOpen = useUIStore((s) => s.setShareDialogOpen);
  const setSettingsDialogOpen = useUIStore((s) => s.setSettingsDialogOpen);
  const setAiAssistantOpen = useUIStore((s) => s.setAiAssistantOpen);
  const setKeyboardShortcutsOpen = useUIStore((s) => s.setKeyboardShortcutsOpen);
  const online = useUIStore((s) => s.online);

  const project = useEditorStore((s) => s.project);
  const save = useEditorStore((s) => s.save);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const pastLen = useEditorStore((s) => s.past.length);
  const futureLen = useEditorStore((s) => s.future.length);
  const scheduleSave = useEditorStore((s) => s.scheduleSave);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project?.name ?? '');

  const initials = (user?.name || user?.email || 'U').slice(0, 2).toUpperCase();

  function commitName() {
    setEditingName(false);
    const newName = nameDraft.trim() || 'Untitled';
    if (project && newName !== project.name) {
      useEditorStore.setState((s) => ({
        project: s.project ? { ...s.project, name: newName } : s.project,
      }));
      scheduleSave();
    }
  }

  const saveStatus = (() => {
    switch (save.status) {
      case 'saving': return { icon: RefreshCw, label: 'Saving…', color: 'text-muted-foreground', spin: true };
      case 'syncing': return { icon: RefreshCw, label: 'Syncing…', color: 'text-amber-500', spin: true };
      case 'saved': return { icon: Check, label: 'Saved', color: 'text-emerald-500', spin: false };
      case 'offline': return { icon: CloudOff, label: 'Offline', color: 'text-amber-500', spin: false };
      case 'error': return { icon: CloudOff, label: 'Save failed', color: 'text-destructive', spin: false };
      default: return { icon: Cloud, label: 'Cloud', color: 'text-muted-foreground', spin: false };
    }
  })();

  const SaveIcon = saveStatus.icon;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 bg-editor-panel px-2 sm:px-3">
      {/* Left: back + logo */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDashboard()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back to dashboard</TooltipContent>
        </Tooltip>
        <div className="hidden sm:flex h-7 w-7 rounded-md overflow-hidden ring-1 ring-primary/30 mr-1">
          <svg viewBox="0 0 512 512" className="h-full w-full">
            <defs>
              <linearGradient id="tb" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f5a623" />
                <stop offset="100%" stopColor="#e07b1a" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" fill="#0a0a0f" />
            <circle cx="256" cy="256" r="140" fill="none" stroke="url(#tb)" strokeWidth="14" opacity="0.9" />
            <path d="M 204 178 L 348 256 L 204 334 Z" fill="url(#tb)" />
          </svg>
        </div>
      </div>

      {/* Project name + save status */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
            className="bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-medium outline-none focus:border-primary/50 min-w-0 max-w-64"
          />
        ) : (
          <button
            onClick={() => { setNameDraft(project?.name ?? ''); setEditingName(true); }}
            className="text-sm font-medium truncate hover:bg-accent/40 rounded px-2 py-1 -mx-2 max-w-64"
            title="Click to rename"
          >
            {project?.name ?? 'Untitled'}
          </button>
        )}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
          <SaveIcon className={`h-3 w-3 ${saveStatus.spin ? 'animate-spin' : ''} ${saveStatus.color}`} />
          <span className={saveStatus.color}>{saveStatus.label}</span>
        </div>
      </div>

      {/* Center: undo/redo */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={pastLen === 0}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Undo <kbd className="ml-1 text-[10px] opacity-70">⌘Z</kbd></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={futureLen === 0}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Redo <kbd className="ml-1 text-[10px] opacity-70">⌘⇧Z</kbd></TooltipContent>
        </Tooltip>
      </div>

      <div className="w-px h-5 bg-border/60 mx-1" />

      {/* Save now */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { useEditorStore.getState().setSaveStatus('saving'); scheduleSave(); }}>
            <Save className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Save now <kbd className="ml-1 text-[10px] opacity-70">⌘S</kbd></TooltipContent>
      </Tooltip>

      {/* Right cluster */}
      <div className="flex items-center gap-1 ml-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAiAssistantOpen(true)}>
              <Sparkles className="h-4 w-4 text-primary" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">AI assistant</TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="sm" className="h-8 hidden sm:flex" onClick={() => setShareDialogOpen(true)}>
          <Share2 className="h-4 w-4 mr-1.5" />
          Share
        </Button>

        <Button size="sm" className="h-8" onClick={() => setExportDialogOpen(true)}>
          <Download className="h-4 w-4 mr-1.5" />
          Export
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center">
              <SettingsIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
              <SettingsIcon className="h-4 w-4 mr-2" /> Project settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
              <Keyboard className="h-4 w-4 mr-2" /> Keyboard shortcuts
              <kbd className="ml-auto text-[10px] opacity-70">?</kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!online}>
              {online ? <Cloud className="h-4 w-4 mr-2" /> : <CloudOff className="h-4 w-4 mr-2" />}
              {online ? 'Online' : 'Offline — changes saved locally'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={async () => { await logout(); openDashboard(); }}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-1 rounded-full pl-0.5 pr-1.5 py-0.5 hover:bg-accent transition">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium truncate">{user?.name || 'Creator'}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openDashboard()}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
              <SettingsIcon className="h-4 w-4 mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => { await logout(); openDashboard(); }}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
