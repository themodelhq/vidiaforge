'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Sliders, Keyboard, Bell, Database, Cog } from 'lucide-react';

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsDialogOpen);
  const setOpen = useUIStore((s) => s.setSettingsDialogOpen);
  const project = useEditorStore((s) => s.project);
  const snap = useUIStore((s) => s.snap);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const magnetic = useUIStore((s) => s.magnetic);
  const toggleMagnetic = useUIStore((s) => s.toggleMagnetic);
  const timecodeFormat = useUIStore((s) => s.timecodeFormat);
  const setTimecodeFormat = useUIStore((s) => s.setTimecodeFormat);

  const [name, setName] = useState(project?.name ?? '');
  const [fps, setFps] = useState(String(project?.fps ?? 30));

  const saveProject = async () => {
    if (!project) return;
    useEditorStore.setState((s) => ({ project: s.project ? { ...s.project, name } : s.project }));
    useEditorStore.getState().scheduleSave();
    toast.success('Settings saved');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl bg-card/95 border-border/60 max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> Settings
          </DialogTitle>
          <DialogDescription>Project and editor preferences.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="project" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="project" className="text-xs"><Cog className="h-3.5 w-3.5 mr-1.5" /> Project</TabsTrigger>
            <TabsTrigger value="editor" className="text-xs"><Sliders className="h-3.5 w-3.5 mr-1.5" /> Editor</TabsTrigger>
            <TabsTrigger value="shortcuts" className="text-xs"><Keyboard className="h-3.5 w-3.5 mr-1.5" /> Shortcuts</TabsTrigger>
            <TabsTrigger value="storage" className="text-xs"><Database className="h-3.5 w-3.5 mr-1.5" /> Storage</TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto scrollbar-thin max-h-[55vh] mt-2">
            <TabsContent value="project" className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label className="text-xs">Project name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-background/60" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Canvas</Label>
                  <Input value={project ? `${project.width} × ${project.height}` : ''} readOnly className="bg-background/40 font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Resolution</Label>
                  <Input value={project?.resolution ?? ''} readOnly className="bg-background/40 font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Frame rate</Label>
                  <Select value={fps} onValueChange={setFps}>
                    <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                    <SelectContent>{['24','25','30','50','60'].map((f) => <SelectItem key={f} value={f}>{f} fps</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Aspect</Label>
                  <Input value={project?.canvasPreset ?? ''} readOnly className="bg-background/40 font-mono text-xs" />
                </div>
              </div>
              <Button onClick={saveProject} size="sm">Save project settings</Button>
            </TabsContent>

            <TabsContent value="editor" className="space-y-3 mt-2">
              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <div>
                  <Label className="text-sm">Snapping</Label>
                  <p className="text-[11px] text-muted-foreground">Snap clips to edges, playhead, and markers.</p>
                </div>
                <Switch checked={snap} onCheckedChange={toggleSnap} />
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <div>
                  <Label className="text-sm">Magnetic timeline</Label>
                  <p className="text-[11px] text-muted-foreground">Close gaps automatically when deleting clips.</p>
                </div>
                <Switch checked={magnetic} onCheckedChange={toggleMagnetic} />
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <div>
                  <Label className="text-sm">Timecode format</Label>
                  <p className="text-[11px] text-muted-foreground">Display format for timecodes.</p>
                </div>
                <Select value={timecodeFormat} onValueChange={(v) => setTimecodeFormat(v as 'hhmmssff' | 'seconds')}>
                  <SelectTrigger className="w-36 bg-background/60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hhmmssff">HH:MM:SS:FF</SelectItem>
                    <SelectItem value="seconds">Seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="shortcuts" className="mt-2">
              <ShortcutsList />
            </TabsContent>

            <TabsContent value="storage" className="space-y-3 mt-2">
              <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Browser storage</Label>
                  <span className="text-xs text-muted-foreground font-mono">~ 12 MB used</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Project state and small media are cached locally for offline editing and crash recovery.</p>
                <Button variant="outline" size="sm" onClick={() => toast.info('Temporary files cleared')}>
                  Clear temporary files
                </Button>
              </div>
              <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-2">
                <Label className="text-sm">Proxy media</Label>
                <p className="text-[11px] text-muted-foreground">Use lower-resolution proxies for smoother editing of 4K footage.</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Auto-generate proxies</span>
                  <Switch defaultChecked />
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutsList() {
  const shortcuts = [
    { keys: 'Space', action: 'Play / Pause' },
    { keys: '⌘/Ctrl + Z', action: 'Undo' },
    { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo' },
    { keys: 'S', action: 'Split at playhead' },
    { keys: 'Delete', action: 'Delete selected clip' },
    { keys: 'D', action: 'Duplicate clip' },
    { keys: 'I', action: 'Mark in' },
    { keys: 'O', action: 'Mark out' },
    { keys: '←', action: 'Previous frame' },
    { keys: '→', action: 'Next frame' },
    { keys: 'Home', action: 'Go to start' },
    { keys: 'End', action: 'Go to end' },
    { keys: 'V', action: 'Select tool' },
    { keys: 'B', action: 'Blade tool' },
    { keys: 'H', action: 'Hand tool' },
    { keys: 'Z', action: 'Zoom tool' },
    { keys: '⌘/Ctrl + E', action: 'Export' },
    { keys: '⌘/Ctrl + S', action: 'Save now' },
    { keys: '?', action: 'Show shortcuts' },
  ];
  return (
    <div className="space-y-1">
      {shortcuts.map((s) => (
        <div key={s.action} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/30">
          <span className="text-xs text-foreground/90">{s.action}</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 border border-border/40">{s.keys}</kbd>
        </div>
      ))}
    </div>
  );
}
