'use client';

import { useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  UploadCloud, Film, Music, Image as ImageIcon, Search, Trash2, Plus,
  Loader2, FolderOpen, Video, Mic, Monitor, AlertCircle,
} from 'lucide-react';
import type { MediaAssetDTO } from '@/lib/types';
import { createTrack } from '@/lib/timeline';
import { RecordingDialog } from '@/components/editor/recording-dialog';

export function MediaPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectId = useEditorStore((s) => s.projectId);
  const assets = useEditorStore((s) => s.assets);
  const addAsset = useEditorStore((s) => s.addAsset);
  const tracks = useEditorStore((s) => s.tracks);
  const addMediaToTimeline = useEditorStore((s) => s.addMediaToTimeline);
  const playhead = useEditorStore((s) => s.playhead);
  const [search, setSearch] = useState('');
  const [uploads, setUploads] = useState<{ name: string; progress: number; kind: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!projectId) return;
    for (const file of arr) {
      const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : null;
      if (!kind) {
        toast.error(`${file.name}: unsupported file type`);
        continue;
      }
      setUploads((u) => [...u, { name: file.name, progress: 0, kind }]);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);
      try {
        const res = await fetch('/api/assets/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        addAsset({
          id: data.asset.id,
          name: data.asset.filename,
          kind: data.asset.kind,
          mimeType: data.asset.mimeType,
          size: data.asset.size,
          duration: data.asset.duration,
          width: data.asset.width,
          height: data.asset.height,
          fps: data.asset.fps,
          thumbnailUrl: data.asset.thumbnailUrl,
          waveformUrl: data.asset.waveformUrl,
          storagePath: data.asset.storagePath,
        });
        toast.success(`${file.name} added`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploads((u) => u.filter((up) => up.name !== file.name));
      }
    }
  }, [projectId, addAsset]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  };

  const addToTimeline = (asset: typeof assets[number]) => {
    const compatibleKinds = asset.kind === 'video' ? ['video'] : asset.kind === 'audio' ? ['audio'] : ['video', 'overlay'];
    let track = tracks.find((t) => compatibleKinds.includes(t.kind) && !t.locked);
    if (!track) {
      const newKind = asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'overlay';
      const newTrack = createTrack(newKind);
      useEditorStore.setState((s) => ({ tracks: [...s.tracks, newTrack] }));
      track = newTrack;
    }
    // V19: cast via unknown to bridge AssetRef → MediaAssetDTO field overlap
    // (AssetRef has storagePath; MediaAssetDTO has filename + createdAt).
    // The function only reads fields they share.
    addMediaToTimeline(asset as unknown as MediaAssetDTO, track.id, playhead);
    toast.success(`Added ${asset.name} to timeline`);
  };

  const deleteAsset = async (id: string) => {
    try {
      await fetch(`/api/assets/${id}`, { method: 'DELETE' });
      useEditorStore.getState().refreshAssets();
      toast.success('Asset deleted');
    } catch {
      toast.error('Failed to delete asset');
    }
  };

  const filtered = assets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files); }}
        className={`relative rounded-lg border-2 border-dashed p-4 text-center transition ${
          dragOver ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/30 hover:border-border'
        }`}
      >
        <UploadCloud className="h-7 w-7 mx-auto text-muted-foreground mb-1.5" />
        <p className="text-xs font-medium">Drop media here</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">or click to browse</p>
        <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*" onChange={onInputChange} className="hidden" />
        <Button variant="secondary" size="sm" className="mt-2 h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
          <FolderOpen className="h-3.5 w-3.5 mr-1.5" /> Browse files
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <RecordButton icon={Video} label="Camera" mode="camera" />
        <RecordButton icon={Mic} label="Voice" mode="voice" />
        <RecordButton icon={Monitor} label="Screen" mode="screen" />
      </div>

      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((u) => (
            <div key={u.name} className="rounded border border-border/40 bg-background/40 p-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span className="text-[11px] truncate flex-1">{u.name}</span>
              </div>
              <Progress value={u.progress} className="h-1 mt-1.5" />
            </div>
          ))}
        </div>
      )}

      {assets.length > 0 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search media…" className="h-8 pl-8 bg-background/60 text-xs" />
        </div>
      )}

      {assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-6 text-center">
          <Film className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
          <p className="text-xs text-muted-foreground">No media imported yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onAdd={() => addToTimeline(asset)} onDelete={() => deleteAsset(asset.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset, onAdd, onDelete }: {
  asset: { id: string; name: string; kind: string; duration?: number; thumbnailUrl?: string; status?: string; errorMessage?: string };
  onAdd: () => void;
  onDelete: () => void;
}) {
  const Icon = asset.kind === 'video' ? Film : asset.kind === 'audio' ? Music : ImageIcon;
  const isAudio = asset.kind === 'audio';
  const status = asset.status || 'ready';
  const isReady = status === 'ready';
  const isProcessing = status === 'processing' || status === 'uploading';
  const isFailed = status === 'failed';
  return (
    <div className="group relative rounded-lg border border-border/40 bg-background/40 overflow-hidden">
      <div
        className="relative aspect-video bg-gradient-to-br from-zinc-800 to-black cursor-pointer flex items-center justify-center"
        onClick={isReady ? onAdd : undefined}
        draggable={isReady}
        onDragStart={isReady ? (e) => { e.dataTransfer.setData('text/asset-id', asset.id); e.dataTransfer.effectAllowed = 'copy'; } : undefined}
      >
        {asset.thumbnailUrl && !isAudio ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <Icon className="h-5 w-5 text-white/40" />
        )}
        {isAudio && (
          <div className="absolute inset-0 flex items-center justify-center gap-px px-2 opacity-60">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="flex-1 bg-emerald-400/70 rounded-sm" style={{ height: `${20 + Math.abs(Math.sin(i)) * 40}%` }} />
            ))}
          </div>
        )}
        {/* Media status overlay */}
        {!isReady && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
            {isProcessing && <Loader2 className="h-5 w-5 text-primary animate-spin mb-1" />}
            {isFailed && <AlertCircle className="h-5 w-5 text-destructive mb-1" />}
            <span className={`text-[10px] font-medium capitalize ${isFailed ? 'text-destructive' : 'text-primary'}`}>
              {status}
            </span>
            {isFailed && asset.errorMessage && (
              <span className="text-[9px] text-muted-foreground mt-0.5 max-w-32 truncate text-center px-2" title={asset.errorMessage}>
                {asset.errorMessage}
              </span>
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!isReady}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        {asset.duration && isReady && (
          <div className="absolute bottom-1 right-1 text-[9px] font-mono bg-black/70 px-1 rounded text-white/80">
            {formatDur(asset.duration)}
          </div>
        )}
      </div>
      <div className="p-1.5 flex items-center gap-1">
        <span className="text-[11px] truncate flex-1" title={asset.name}>{asset.name}</span>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function RecordButton({ icon: Icon, label, mode }: { icon: React.ElementType; label: string; mode: 'camera' | 'voice' | 'screen' }) {
  const [open, setOpen] = useState(false);
  // These are stored at the MediaPanel level instead — but since we need the dialog
  // at panel level to avoid multiple instances, we use a small wrapper.
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center gap-1 rounded-md border border-border/40 bg-background/40 py-2 text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition"
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
      <RecordingDialog open={open} onOpenChange={setOpen} mode={mode} />
    </>
  );
}

function formatDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
