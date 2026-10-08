'use client';

import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Music2, Search, Play, Pause, Heart, Plus, Headphones, AudioLines } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

const MUSIC_LIBRARY: { id: string; title: string; artist: string; category: string; duration: number; bpm: number; mood: string; gradient: string }[] = [
  { id: 'm1', title: 'Sunset Drive', artist: 'VidiaForge Library', category: 'Cinematic', duration: 142, bpm: 90, mood: 'Dreamy', gradient: 'from-amber-600 to-orange-700' },
  { id: 'm2', title: 'Afro Pulse', artist: 'VidiaForge Library', category: 'Afrobeats', duration: 168, bpm: 104, mood: 'Energetic', gradient: 'from-orange-600 to-rose-600' },
  { id: 'm3', title: 'Cinematic Rise', artist: 'VidiaForge Library', category: 'Cinematic', duration: 95, bpm: 70, mood: 'Epic', gradient: 'from-stone-700 to-amber-700' },
  { id: 'm4', title: 'Lofi Study', artist: 'VidiaForge Library', category: 'Ambient', duration: 210, bpm: 75, mood: 'Calm', gradient: 'from-emerald-700 to-teal-800' },
  { id: 'm5', title: 'Corporate Up', artist: 'VidiaForge Library', category: 'Corporate', duration: 124, bpm: 120, mood: 'Inspiring', gradient: 'from-amber-700 to-yellow-600' },
  { id: 'm6', title: 'Emotional Piano', artist: 'VidiaForge Library', category: 'Emotional', duration: 188, bpm: 60, mood: 'Reflective', gradient: 'from-violet-700 to-fuchsia-700' },
  { id: 'm7', title: 'Suspense Build', artist: 'VidiaForge Library', category: 'Suspense', duration: 76, bpm: 100, mood: 'Tense', gradient: 'from-zinc-700 to-red-800' },
  { id: 'm8', title: 'Podcast Intro', artist: 'VidiaForge Library', category: 'Podcast', duration: 18, bpm: 110, mood: 'Friendly', gradient: 'from-amber-600 to-stone-700' },
];

const SFX_LIBRARY: { id: string; name: string; category: string; duration: number }[] = [
  { id: 's1', name: 'Whoosh', category: 'Whoosh', duration: 1.2 },
  { id: 's2', name: 'Impact Boom', category: 'Impact', duration: 2.5 },
  { id: 's3', name: 'Click', category: 'Click', duration: 0.3 },
  { id: 's4', name: 'Pop', category: 'Pop', duration: 0.4 },
  { id: 's5', name: 'Camera Shutter', category: 'Camera', duration: 0.8 },
  { id: 's6', name: 'Crowd Cheer', category: 'Crowd', duration: 6 },
  { id: 's7', name: 'Rain Ambience', category: 'Nature', duration: 30 },
  { id: 's8', name: 'Notification', category: 'UI', duration: 0.6 },
];

const CATEGORIES = ['All', 'Cinematic', 'Afrobeats', 'Corporate', 'Ambient', 'Emotional', 'Suspense', 'Podcast'];

export function AudioPanel() {
  const [tab, setTab] = useState<'music' | 'sfx' | 'voiceover'>('music');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);

  const filtered = MUSIC_LIBRARY.filter((m) =>
    (category === 'All' || m.category === category) &&
    (m.title.toLowerCase().includes(search.toLowerCase()) || m.artist.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-1 rounded-md bg-background/40 p-0.5">
        {(['music', 'sfx', 'voiceover'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium capitalize ${tab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'sfx' ? 'Sound FX' : t}
          </button>
        ))}
      </div>

      {tab === 'music' && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search music…" className="h-8 pl-8 bg-background/60 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2 py-0.5 rounded-full text-[10px] ${category === c ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filtered.map((track) => (
              <div key={track.id} className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/40 p-2 hover:bg-accent/30 transition">
                <button
                  onClick={() => setPlaying((p) => (p === track.id ? null : track.id))}
                  className={`relative h-10 w-10 shrink-0 rounded bg-gradient-to-br ${track.gradient} flex items-center justify-center`}
                >
                  {playing === track.id ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{track.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{track.artist} · {track.bpm} BPM · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => toast.info(`"${track.title}" is a licensed preview — full library coming soon`)} className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-amber-500">
                    <Heart className="h-3 w-3" />
                  </button>
                  <button onClick={() => toast.info(`"${track.title}" added — licensed audio coming soon`)} className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'sfx' && (
        <div className="grid grid-cols-2 gap-2">
          {SFX_LIBRARY.map((sfx) => (
            <button
              key={sfx.id}
              onClick={() => toast.info(`"${sfx.name}" — licensed SFX coming soon`)}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 p-2 hover:bg-accent/30 transition text-left"
            >
              <div className="h-8 w-8 rounded bg-muted/40 flex items-center justify-center">
                <AudioLines className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{sfx.name}</div>
                <div className="text-[10px] text-muted-foreground">{sfx.duration}s</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'voiceover' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
            <Headphones className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">AI Voiceover</p>
            <p className="text-[11px] text-muted-foreground mt-1">Generate narration from text using AI voices.</p>
            <button onClick={() => toast.info('AI voiceover — coming soon')} className="mt-2 px-3 py-1 rounded-md bg-primary/15 text-primary text-xs">
              Open voiceover studio
            </button>
          </div>
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
            <Music2 className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">Record voiceover</p>
            <p className="text-[11px] text-muted-foreground mt-1">Use your microphone to record narration.</p>
            <button onClick={() => toast.info('Mic recording — coming soon')} className="mt-2 px-3 py-1 rounded-md bg-primary/15 text-primary text-xs">
              Start recording
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
