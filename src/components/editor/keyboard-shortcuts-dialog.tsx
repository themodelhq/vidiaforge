'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useUIStore } from '@/stores/ui-store';
import { Keyboard } from 'lucide-react';

const GROUPS = [
  {
    title: 'Playback',
    items: [
      { keys: 'Space', action: 'Play / Pause' },
      { keys: '←', action: 'Previous frame' },
      { keys: '→', action: 'Next frame' },
      { keys: 'Home', action: 'Go to start' },
      { keys: 'End', action: 'Go to end' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'S', action: 'Split at playhead' },
      { keys: 'Delete', action: 'Delete selected clip' },
      { keys: 'D', action: 'Duplicate clip' },
      { keys: 'I', action: 'Mark in' },
      { keys: 'O', action: 'Mark out' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: '⌘/Ctrl + Z', action: 'Undo' },
      { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo' },
      { keys: '⌘/Ctrl + Y', action: 'Redo (alt)' },
      { keys: '⌘/Ctrl + S', action: 'Save now' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { keys: 'V', action: 'Select tool' },
      { keys: 'B', action: 'Blade tool' },
      { keys: 'H', action: 'Hand tool' },
      { keys: 'Z', action: 'Zoom tool' },
    ],
  },
  {
    title: 'Other',
    items: [
      { keys: '⌘/Ctrl + E', action: 'Export' },
      { keys: '?', action: 'Show this dialog' },
    ],
  },
];

export function KeyboardShortcutsDialog() {
  const open = useUIStore((s) => s.keyboardShortcutsOpen);
  const setOpen = useUIStore((s) => s.setKeyboardShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg bg-card/95 border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{g.title}</h3>
              <div className="space-y-1">
                {g.items.map((item) => (
                  <div key={item.action} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs text-foreground/90">{item.action}</span>
                    <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 whitespace-nowrap">{item.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
