'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import {
  Download, Film, Check, Loader2, X, Clock, Cog, AlertTriangle, Server,
} from 'lucide-react';

const FORMATS = [
  { id: 'mp4', label: 'MP4 (H.264)', desc: 'Best compatibility', icon: Film },
  { id: 'webm', label: 'WebM (VP9)', desc: 'Web optimized', icon: Film },
];

const RESOLUTIONS = ['480p', '720p', '1080p', '1440p', '4K'];
const FPS = [24, 25, 30, 50, 60];
const BITRATES = [
  { id: 'low', label: 'Low', desc: 'Smaller file' },
  { id: 'medium', label: 'Medium', desc: 'Balanced' },
  { id: 'high', label: 'High', desc: 'Best quality' },
];

const EXPORT_PRESETS = [
  { id: 'youtube-1080', label: 'YouTube 1080p', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'high' },
  { id: 'youtube-4k', label: 'YouTube 4K', format: 'mp4', resolution: '4K', fps: 30, bitrate: 'high' },
  { id: 'tiktok', label: 'TikTok', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'medium' },
  { id: 'reels', label: 'Instagram Reels', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'medium' },
  { id: 'shorts', label: 'YouTube Shorts', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'medium' },
  { id: 'feed', label: 'Instagram Feed', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'medium' },
  { id: 'linkedin', label: 'LinkedIn', format: 'mp4', resolution: '1080p', fps: 30, bitrate: 'medium' },
];

export function ExportDialog() {
  const open = useUIStore((s) => s.exportDialogOpen);
  const setOpen = useUIStore((s) => s.setExportDialogOpen);
  const project = useEditorStore((s) => s.project);
  const projectId = useEditorStore((s) => s.projectId);
  const duration = useEditorStore((s) => s.duration);
  const renderJobs = useEditorStore((s) => s.renderJobs);
  const refreshRenderJobs = useEditorStore((s) => s.refreshRenderJobs);
  const clips = useEditorStore((s) => s.clips);

  const [format, setFormat] = useState('mp4');
  const [resolution, setResolution] = useState('1080p');
  // Sync fps from project (use initial state, not effect-driven setState)
  const [fps, setFps] = useState(project?.fps ?? 30);
  const [bitrate, setBitrate] = useState('medium');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  // Poll render jobs when open
  useEffect(() => {
    if (!open) return;
    refreshRenderJobs();
    const interval = setInterval(refreshRenderJobs, 1500);
    return () => clearInterval(interval);
  }, [open, refreshRenderJobs]);

  // Track active job status
  const activeJob = activeJobId ? renderJobs.find((j) => j.id === activeJobId) : null;
  const isExporting = activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing');

  const startExport = async () => {
    if (!projectId) return;
    setQueueError(null);
    setActiveJobId(null);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, format, codec: format === 'mp4' ? 'h264' : 'vp9', resolution, fps, bitrate }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Honest error — render queue may not be configured
        const errMsg = data.error || 'Failed to start render';
        setQueueError(errMsg);
        toast.error(errMsg);
        return;
      }
      setActiveJobId(data.job.id);
      toast.success('Render job queued');
      refreshRenderJobs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error starting render';
      setQueueError(msg);
      toast.error(msg);
    }
  };

  const cancelJob = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/render/${activeJobId}/cancel`, { method: 'POST' });
      toast.success('Render cancelled');
      refreshRenderJobs();
    } catch {
      toast.error('Failed to cancel render');
    }
  };

  const applyPreset = (preset: typeof EXPORT_PRESETS[number]) => {
    setFormat(preset.format);
    setResolution(preset.resolution);
    setFps(preset.fps);
    setBitrate(preset.bitrate);
    setShowPresets(false);
    toast.info(`Applied ${preset.label} preset`);
  };

  const hasMediaClips = clips.some((c) => c.kind === 'video' || c.kind === 'audio' || c.kind === 'image');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isExporting) { setOpen(o); if (!o) { setActiveJobId(null); setQueueError(null); } } }}>
      <DialogContent className="max-w-lg bg-card/95 border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" /> Export video
          </DialogTitle>
          <DialogDescription>
            Render your project to a downloadable video file.
            {duration > 0 && ` Duration: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Active job status */}
        {isExporting && activeJob ? (
          <div className="py-6 space-y-3">
            <div className="text-center">
              {activeJob.status === 'queued' ? (
                <Clock className="h-8 w-8 text-amber-500 mx-auto mb-2 animate-pulse" />
              ) : (
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
              )}
              <p className="text-sm font-medium capitalize">{activeJob.stage || activeJob.status}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeJob.status === 'queued' ? 'Waiting for render worker…' : `${Math.round(activeJob.progress * 100)}% complete`}
              </p>
            </div>
            {activeJob.status === 'processing' && (
              <Progress value={activeJob.progress * 100} className="h-2" />
            )}
            <p className="text-[11px] text-muted-foreground text-center">You can keep editing — rendering happens in the background.</p>
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={cancelJob}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Cancel render
              </Button>
            </div>
          </div>
        ) : queueError ? (
          /* Honest error state — render queue not configured */
          <div className="py-4 space-y-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-500">Render queue not available</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {queueError}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    To enable rendering, set <code className="text-foreground bg-muted/40 px-1 rounded">REDIS_URL</code> and deploy the background worker with FFmpeg. See <code className="text-foreground bg-muted/40 px-1 rounded">docs/REMEDIATION.md</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : !hasMediaClips ? (
          <div className="py-4 space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-center">
              <Film className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium">No media on the timeline</p>
              <p className="text-xs text-muted-foreground mt-1">Add video, audio, or image clips before exporting.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Export presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Presets</Label>
                <button onClick={() => setShowPresets((s) => !s)} className="text-[11px] text-primary hover:underline">
                  {showPresets ? 'Hide' : 'Show'} presets
                </button>
              </div>
              {showPresets && (
                <div className="flex flex-wrap gap-1.5">
                  {EXPORT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p)}
                      className="px-2 py-1 rounded text-[11px] bg-muted/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Format */}
            <div className="space-y-2">
              <Label className="text-xs">Format</Label>
              <div className="grid grid-cols-2 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`rounded-lg border p-2.5 text-left transition ${format === f.id ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/40 hover:bg-accent/30'}`}
                  >
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground">{f.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div className="space-y-2">
              <Label className="text-xs">Resolution</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOLUTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}{r === '4K' && <span className="ml-2 text-[10px] text-amber-500">Pro</span>}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* FPS */}
            <div className="space-y-2">
              <Label className="text-xs">Frame rate</Label>
              <Select value={String(fps)} onValueChange={(v) => setFps(parseInt(v))}>
                <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FPS.map((f) => <SelectItem key={f} value={String(f)}>{f} fps</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Bitrate */}
            <div className="space-y-2">
              <Label className="text-xs">Quality</Label>
              <div className="grid grid-cols-3 gap-2">
                {BITRATES.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBitrate(b.id)}
                    className={`rounded-lg border p-2 text-center transition ${bitrate === b.id ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/40 hover:bg-accent/30'}`}
                  >
                    <div className="text-xs font-medium">{b.label}</div>
                    <div className="text-[10px] text-muted-foreground">{b.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Recent renders */}
            {renderJobs.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Render history</Label>
                <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-1">
                  {renderJobs.slice(0, 8).map((job) => (
                    <div key={job.id} className="flex items-center gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
                      <span className="font-mono text-[10px] text-muted-foreground">{job.format.toUpperCase()}</span>
                      <span className="flex-1 truncate">{job.resolution} · {job.fps}fps</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] capitalize ${
                        job.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                        job.status === 'processing' ? 'bg-amber-500/20 text-amber-400' :
                        job.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        job.status === 'cancelled' ? 'bg-muted/40 text-muted-foreground' :
                        'bg-muted/40 text-muted-foreground'
                      }`}>{job.status}</span>
                      {job.status === 'completed' && job.outputUrl && (
                        <a
                          href={job.outputUrl}
                          download
                          className="flex items-center justify-center h-5 w-5 rounded hover:bg-accent transition"
                          title="Download rendered video"
                        >
                          <Download className="h-3 w-3 text-primary" />
                        </a>
                      )}
                      {job.status === 'failed' && job.error && (
                        <span className="text-[10px] text-red-400 truncate max-w-24" title={job.error}>error</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground flex items-start gap-2">
              <Server className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Rendering requires a background worker with FFmpeg. If <code className="text-foreground bg-muted/40 px-0.5 rounded">REDIS_URL</code> is not configured, the render queue will return an error. See <code className="text-foreground bg-muted/40 px-0.5 rounded">docs/REMEDIATION.md</code>.</span>
            </div>
          </div>
        )}

        {!isExporting && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); setActiveJobId(null); setQueueError(null); }}>Close</Button>
            {!queueError && hasMediaClips && (
              <Button onClick={startExport} className="min-w-32">
                <Download className="h-4 w-4 mr-1.5" /> Start render
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
