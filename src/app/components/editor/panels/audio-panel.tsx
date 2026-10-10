'use client';

// VidiaForge V19.1 §4 — Audio Panel (REAL catalog-backed)
//
// V19.1 §4.5 — Acceptance: "The music library does not present generated
// test tones as real music."
//
// This panel fetches the REAL audio catalog from /api/audio/catalog.
//   - SFX sub-tab: lists the real built-in SFX (white/pink/brown noise
//     WAVs generated with FFmpeg). These are genuinely usable as
//     production sound effects.
//   - Music sub-tab: lists licensed music tracks from the configured
//     external provider. When NO provider is configured (the default),
//     the panel renders an HONEST empty state:
//       "No music catalog configured.
//        Upload your licensed audio in the Media panel."
//     We never present test tones as music.
//   - Voiceover sub-tab: delegates to the existing RecordingDialog
//     for real mic recording; AI voiceover is honestly marked as
//     requiring a backend provider.
//
// The panel uses a single shared HTMLAudioElement so only one preview
// can play at a time. Durations are read from the loaded metadata —
// never fabricated.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { toast } from 'sonner';
import {
  Search, Play, Pause, Plus, Headphones, AudioLines, Volume2,
  Loader2, AlertCircle, RotateCcw, Mic, Upload, Music2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createTrack } from '@/lib/timeline';
import type { MediaAssetDTO, AssetRef } from '@/lib/types';
import { RecordingDialog } from '@/components/editor/recording-dialog';
import {
  normalizeApiError,
  responseToErrorMessage,
} from '@/lib/errors/client';

// V19.1 §4.3 — Real audio metadata shape returned by /api/audio/catalog
interface RealAudioTrack {
  id: string;
  title: string;
  artist: string;
  category: string;
  mood: string;
  duration: number;
  format: string;
  sampleRate: number;
  channels: number;
  size: number;
  url: string;
  thumbnailUrl: string;
  previewAvailable: boolean;
  licenseType: string;
  attributionRequired: boolean;
  attributionLine: string;
  available: boolean;
  source: string;
}

interface CatalogResponse {
  music: RealAudioTrack[];
  sfx: RealAudioTrack[];
  provider: {
    name: string;
    configured: boolean;
    external: { name: string; configured: boolean };
  };
}

type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed';

// Helper to format seconds as m:ss
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Convert an id to a deterministic gradient for visual variety when no
// thumbnail is available.
function gradientFor(id: string): string {
  const map: Record<string, string> = {
    'sfx-whoosh':       'from-amber-700 to-orange-800',
    'sfx-impact':       'from-zinc-700 to-red-800',
    'sfx-click':        'from-amber-600 to-stone-700',
    'sfx-pop':          'from-amber-700 to-yellow-700',
    'sfx-shutter':      'from-stone-700 to-amber-700',
    'sfx-crowd':        'from-emerald-700 to-teal-800',
    'sfx-rain':         'from-zinc-700 to-blue-900',
    'sfx-notification': 'from-amber-600 to-rose-700',
  };
  return map[id] || 'from-zinc-700 to-zinc-800';
}

export function AudioPanel() {
  const [tab, setTab] = useState<'music' | 'sfx' | 'voiceover'>('music');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  // V19.1 §4.2: catalog state fetched from the backend
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Single shared preview player — only one preview can play at a time.
  const audioEl = useMemo<HTMLAudioElement | null>(() => {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio();
    el.preload = 'metadata';
    return el;
  }, []);
  const audioRef = useRef<HTMLAudioElement | null>(audioEl);

  // Per-track loading + duration state. Durations are read from real metadata.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failedIds, setFailedIds] = useState<Record<string, string>>({});

  // Editor + auth wiring for "Add to timeline"
  const addMediaToTimeline = useEditorStore((s) => s.addMediaToTimeline);
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const projectId = useEditorStore((s) => s.projectId);
  const user = useAuthStore((s) => s.user);
  const setView = useUIStore((s) => s.setView);
  const setCreateProjectOpen = useUIStore((s) => s.setCreateProjectOpen);

  // V19.1 §4.2: fetch the real catalog from the backend
  const fetchCatalog = useCallback(async () => {
    if (catalogLoading) return;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch('/api/audio/catalog', { cache: 'no-store' });
      if (!res.ok) {
        const msg = await responseToErrorMessage(res, 'Failed to load audio catalog');
        throw new Error(msg);
      }
      const data: CatalogResponse = await res.json();
      setCatalog(data);
    } catch (err) {
      const msg = normalizeApiError(err, 'Failed to load audio catalog');
      setCatalogError(msg);
      // Don't toast — show inline so the user sees the error in context.
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogLoading]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Wire up <audio> element events
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => {
      setStatus((s) => (s === 'loading' ? 'ready' : s));
      setDuration(isFinite(el.duration) ? el.duration : 0);
    };
    const onTime = () => setPosition(el.currentTime);
    const onPlay = () => setStatus('playing');
    const onPause = () => setStatus((s) => (s === 'playing' ? 'paused' : s));
    const onEnded = () => {
      setStatus('paused');
      setPosition(0);
      el.currentTime = 0;
    };
    const onError = () => {
      setStatus('failed');
      if (currentId) {
        setFailedIds((prev) => ({
          ...prev,
          [currentId]: 'This audio asset failed to load. It may be missing or unsupported.',
        }));
      }
    };

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('durationchange', onLoaded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('durationchange', onLoaded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [currentId]);

  // Release the audio element on unmount — important to avoid the audio
  // continuing to play after the user closes the panel.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        try {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const playTrack = useCallback((track: RealAudioTrack) => {
    const el = audioRef.current;
    if (!el) return;

    if (currentId === track.id) {
      if (el.paused) {
        setStatus('loading');
        el.play().catch(() => setStatus('failed'));
      } else {
        el.pause();
      }
      return;
    }

    setCurrentId(track.id);
    setStatus('loading');
    setPosition(0);
    setDuration(track.duration || 0);
    el.src = track.url;
    el.currentTime = 0;
    el.play().then(() => setStatus('playing')).catch(() => setStatus('paused'));
  }, [currentId]);

  const togglePlayPause = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentId) return;
    if (el.paused) {
      el.play().then(() => setStatus('playing')).catch(() => setStatus('failed'));
    } else {
      el.pause();
    }
  }, [currentId]);

  const seekTo = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    if (!isFinite(sec)) return;
    el.currentTime = Math.max(0, Math.min(sec, isFinite(el.duration) ? el.duration : sec));
    setPosition(el.currentTime);
  }, []);

  const handleAddToTimeline = useCallback((track: RealAudioTrack) => {
    if (!user) {
      toast.error('Please sign in to add audio to a project');
      setView('login');
      return;
    }
    if (!projectId) {
      toast.error('Open a project before adding audio to the timeline');
      // Open the create-project dialog so the user can start one.
      setCreateProjectOpen(true);
      return;
    }
    if (!track.available || !track.previewAvailable) {
      toast.error('This audio asset is not available.');
      return;
    }

    // Find or create a compatible unlocked audio track
    let trackObj = tracks.find((t) => t.kind === 'audio' && !t.locked);
    if (!trackObj) {
      trackObj = createTrack('audio');
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, trackObj!] }));
    }

    // Build a real AssetRef pointing at the audio URL. The renderer
    // fetches the bytes from this URL when the project is exported.
    const asset: AssetRef = {
      id: track.id,
      name: track.title,
      kind: 'audio',
      mimeType: track.format === 'mp3' ? 'audio/mpeg' : `audio/${track.format}`,
      size: track.size,
      duration: isFinite(duration) && currentId === track.id ? duration : (track.duration || undefined),
      storagePath: track.url,
      status: 'ready',
    };
    addMediaToTimeline(asset as unknown as MediaAssetDTO, trackObj.id, playhead);
    toast.success(`Added "${asset.name}" to timeline`);
  }, [user, projectId, tracks, playhead, addMediaToTimeline, setView, setCreateProjectOpen, duration, currentId]);

  // Derived: filtered music + SFX + category list
  const musicTracks = catalog?.music ?? [];
  const sfxTracks = catalog?.sfx ?? [];

  // Build category list from the union of music + sfx categories
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    musicTracks.forEach((t) => set.add(t.category));
    sfxTracks.forEach((t) => set.add(t.category));
    return ['All', ...Array.from(set).sort()];
  }, [musicTracks, sfxTracks]);

  const filteredMusic = useMemo(() => {
    const q = search.toLowerCase();
    return musicTracks.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (q) {
        const hay = `${t.title} ${t.artist} ${t.category} ${t.mood}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [musicTracks, search, category]);

  const filteredSfx = useMemo(() => {
    const q = search.toLowerCase();
    return sfxTracks.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (q) {
        const hay = `${t.title} ${t.category} ${t.mood}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sfxTracks, search, category]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-1 rounded-md bg-background/40 p-0.5">
        {(['music', 'sfx', 'voiceover'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium capitalize transition ${
              tab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'sfx' ? 'Sound FX' : t}
          </button>
        ))}
      </div>

      {/* Honest catalog source banner */}
      {catalog && (
        <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5 text-[10px] text-muted-foreground leading-snug">
          {catalog.provider.external.configured ? (
            <>Music source: <span className="text-foreground font-medium">{catalog.provider.external.name}</span> (configured)</>
          ) : (
            <>Music source: <span className="text-amber-300/80">not configured</span> — upload your own licensed audio in the Media panel.</>
          )}
        </div>
      )}

      {tab === 'music' && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search music…" className="h-8 pl-8 bg-background/60 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1">
            {allCategories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2 py-0.5 rounded-full text-[10px] transition ${
                  category === c ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {catalogLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : catalogError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center">
              <AlertCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
              <p className="text-[11px] text-destructive">{catalogError}</p>
              <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={fetchCatalog}>
                <RotateCcw className="h-3 w-3 mr-1.5" /> Retry
              </Button>
            </div>
          ) : filteredMusic.length === 0 ? (
            // V19.1 §4.5 — Acceptance: honest empty state, NOT fake tracks.
            <div className="rounded-lg border border-dashed border-border/60 p-5 text-center">
              <Music2 className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs font-medium">No music catalog configured</p>
              <p className="text-[11px] text-muted-foreground mt-1 max-w-[260px] mx-auto">
                The built-in audio library ships real sound effects only. To use
                licensed music, upload your own audio files in the Media panel —
                or have your administrator configure an external music provider
                (AUDIO_PROVIDER env var) on the backend.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 text-xs"
                onClick={() => {
                  // V19.1 §4.4: the upload flow lives in the Media panel.
                  // Switch the sidebar to the Media tab so the user can
                  // drop in their own licensed audio.
                  useUIStore.getState().setActiveSidebarTab('media');
                }}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload your audio
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMusic.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isCurrent={currentId === track.id}
                  isPlaying={currentId === track.id && status === 'playing'}
                  isLoading={currentId === track.id && status === 'loading'}
                  position={currentId === track.id ? position : 0}
                  duration={currentId === track.id && isFinite(duration) ? duration : track.duration}
                  failed={!!failedIds[track.id]}
                  failedReason={failedIds[track.id]}
                  onPlay={() => playTrack(track)}
                  onSeek={seekTo}
                  onAdd={() => handleAddToTimeline(track)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'sfx' && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SFX…" className="h-8 pl-8 bg-background/60 text-xs" />
          </div>
          {catalogLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : catalogError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center">
              <AlertCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
              <p className="text-[11px] text-destructive">{catalogError}</p>
            </div>
          ) : filteredSfx.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 p-3 text-center">
              <AudioLines className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-[11px] text-muted-foreground">No sound effects match your search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filteredSfx.map((sfx) => {
                const isCurrent = currentId === sfx.id;
                const isPlaying = isCurrent && status === 'playing';
                const isLoading = isCurrent && status === 'loading';
                return (
                  <div
                    key={sfx.id}
                    className={`flex items-center gap-2 rounded-lg border bg-background/40 p-2 transition ${
                      isCurrent ? 'border-primary/50' : 'border-border/40 hover:bg-accent/30'
                    }`}
                  >
                    <button
                      onClick={() => playTrack(sfx)}
                      className="h-8 w-8 rounded bg-muted/40 flex items-center justify-center"
                      aria-label={isPlaying ? `Pause ${sfx.title}` : `Play ${sfx.title}`}
                    >
                      {isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <AudioLines className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{sfx.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {sfx.mood} · {fmtTime(sfx.duration)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddToTimeline(sfx)}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100"
                      aria-label={`Add ${sfx.title} to timeline`}
                      title="Add to timeline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'voiceover' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
            <Headphones className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">AI Voiceover</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Generate narration from text using AI voices. Requires a
              configured transcription/TTS provider on the backend.
            </p>
            <p className="text-[10px] text-amber-300/80 mt-1">
              Not configured on this deployment. Upload your own voiceover in
              the Media panel instead.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
            <Mic className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">Record voiceover</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Use your microphone to record narration directly in the browser.
            </p>
            <RecordVoiceoverButton disabled={!user || !projectId} />
          </div>
        </div>
      )}

      {/* Currently-playing shared footer with transport controls */}
      {currentId && (status === 'playing' || status === 'paused' || status === 'loading') && (
        <div className="mt-1 rounded-md border border-border/40 bg-background/60 p-2 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={togglePlayPause} className="h-7 w-7 p-0">
            {status === 'playing' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={isFinite(duration) ? duration : 0}
            step={0.05}
            value={position}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            className="vf-range flex-1 h-1"
            aria-label="Seek audio"
          />
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {fmtTime(position)} / {fmtTime(duration)}
          </span>
          <button
            onClick={() => {
              const el = audioRef.current;
              if (el) {
                el.pause();
                el.removeAttribute('src');
                el.load();
              }
              setCurrentId(null);
              setStatus('idle');
              setPosition(0);
              setDuration(0);
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Stop preview"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface TrackRowProps {
  track: RealAudioTrack;
  isCurrent: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  position: number;
  duration: number;
  failed: boolean;
  failedReason?: string;
  onPlay: () => void;
  onSeek: (sec: number) => void;
  onAdd: () => void;
}

function TrackRow({
  track, isCurrent, isPlaying, isLoading, position, duration, failed, failedReason,
  onPlay, onSeek, onAdd,
}: TrackRowProps) {
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-lg border bg-background/40 p-2 transition ${
        isCurrent ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border/40 hover:bg-accent/30'
      }`}
    >
      <button
        onClick={onPlay}
        className={`relative h-10 w-10 shrink-0 rounded bg-gradient-to-br ${gradientFor(track.id)} flex items-center justify-center`}
        aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4 text-white" />
        ) : (
          <Play className="h-4 w-4 text-white" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate" title={track.title}>{track.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {track.artist} · {track.category} · {fmtTime(duration)}
        </div>
        {isCurrent && (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={isFinite(duration) ? duration : 0}
              step={0.05}
              value={position}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="vf-range w-full h-1"
              aria-label="Seek audio"
            />
            <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
              {fmtTime(position)} / {fmtTime(duration)}
            </span>
          </div>
        )}
        {failed && failedReason && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>{failedReason}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={onAdd}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary"
          aria-label={`Add ${track.title} to timeline`}
          title="Add to timeline"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// Honest "record voiceover" button — opens the existing RecordingDialog
// flow which implements real getUserMedia recording + uploads the
// resulting blob via /api/assets/upload.
function RecordVoiceoverButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 h-7 text-xs"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Mic className="h-3.5 w-3.5 mr-1.5" /> Start recording
      </Button>
      <RecordingDialog open={open} onOpenChange={setOpen} mode="voice" />
    </>
  );
}
