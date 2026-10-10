'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Sticker, Search } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { createClip, createTrack } from '@/lib/timeline';

const STICKERS: { id: string; emoji: string; name: string; category: string }[] = [
  { id: 's1', emoji: '🔥', name: 'Fire', category: 'Trending' },
  { id: 's2', emoji: '✨', name: 'Sparkles', category: 'Trending' },
  { id: 's3', emoji: '💯', name: '100', category: 'Trending' },
  { id: 's4', emoji: '👍', name: 'Thumbs Up', category: 'Gesture' },
  { id: 's5', emoji: '❤️', name: 'Heart', category: 'Emoji' },
  { id: 's6', emoji: '😂', name: 'Laughing', category: 'Emoji' },
  { id: 's7', emoji: '🎉', name: 'Party', category: 'Celebration' },
  { id: 's8', emoji: '⭐', name: 'Star', category: 'Shapes' },
  { id: 's9', emoji: '➡️', name: 'Arrow', category: 'Shapes' },
  { id: 's10', emoji: '💰', name: 'Money', category: 'Business' },
  { id: 's11', emoji: '🎬', name: 'Clapper', category: 'Film' },
  { id: 's12', emoji: '🎵', name: 'Music', category: 'Film' },
];

const SHAPES: { id: string; svg: string; name: string }[] = [
  { id: 'sh1', svg: '<rect width="40" height="40" rx="4" fill="currentColor"/>', name: 'Square' },
  { id: 'sh2', svg: '<circle cx="20" cy="20" r="18" fill="currentColor"/>', name: 'Circle' },
  { id: 'sh3', svg: '<polygon points="20,2 38,38 2,38" fill="currentColor"/>', name: 'Triangle' },
  { id: 'sh4', svg: '<polygon points="20,2 38,20 20,38 2,20" fill="currentColor"/>', name: 'Diamond' },
  { id: 'sh5', svg: '<path d="M20 4 L36 36 L4 36 Z" stroke="currentColor" stroke-width="3" fill="none"/>', name: 'Outline' },
  { id: 'sh6', svg: '<rect width="40" height="8" y="16" fill="currentColor"/>', name: 'Bar' },
];

export function StickersPanel() {
  const [search, setSearch] = useState('');
  const tracks = useEditorStore((s) => s.tracks);
  const addClip = useEditorStore((s) => s.addClip);
  const playhead = useEditorStore((s) => s.playhead);

  const addSticker = (emoji: string, name: string) => {
    let track = tracks.find((t) => t.kind === 'overlay' && !t.locked);
    if (!track) {
      track = createTrack('overlay', 'Stickers');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const clip = createClip({
      trackId: track.id,
      kind: 'sticker',
      timelineStart: playhead,
      duration: 3,
      label: name,
    });
    // store emoji in a custom way via text
    clip.text = { text: emoji, fontFamily: 'Inter', fontSize: 80, fontWeight: 400, italic: false, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff', animation: 'pop' };
    addClip(clip);
    toast.success(`Added ${name}`);
  };

  const addShape = (name: string) => {
    let track = tracks.find((t) => t.kind === 'overlay' && !t.locked);
    if (!track) {
      track = createTrack('overlay', 'Shapes');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
    }
    const clip = createClip({
      trackId: track.id,
      kind: 'shape',
      timelineStart: playhead,
      duration: 3,
      label: name,
    });
    addClip(clip);
    toast.success(`Added ${name} shape`);
  };

  const filtered = STICKERS.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stickers…" className="h-8 pl-8 bg-background/60 text-xs" />
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Sticker className="h-3 w-3" /> Stickers
        </h3>
        <div className="grid grid-cols-4 gap-1.5">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => addSticker(s.emoji, s.name)}
              className="aspect-square rounded-lg border border-border/40 bg-background/40 hover:border-primary/50 hover:bg-accent/30 transition flex items-center justify-center text-2xl"
            >
              {s.emoji}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Shapes</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {SHAPES.map((sh) => (
            <button
              key={sh.id}
              onClick={() => addShape(sh.name)}
              className="aspect-square rounded-lg border border-border/40 bg-background/40 hover:border-primary/50 hover:bg-accent/30 transition flex items-center justify-center text-primary"
              dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 40 40" class="h-6 w-6">${sh.svg}</svg>` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
