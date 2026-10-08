'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import {
  Video, Mic, Monitor, Camera, Square, Loader2, X, RotateCcw, AlertCircle,
} from 'lucide-react';

type RecordMode = 'camera' | 'screen' | 'camera+screen' | 'voice';

interface RecordingState {
  mode: RecordMode;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  isRecording: boolean;
  elapsed: number;
  error: string | null;
}

const VIDEO_CONSTRAINTS: Record<string, MediaTrackConstraints> = {
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  '480p': { width: { ideal: 640 }, height: { ideal: 480 } },
};

const FPS_OPTIONS = [24, 30, 60];

export function RecordingDialog({ open, onOpenChange, mode: initialMode }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RecordMode;
}) {
  const projectId = useEditorStore((s) => s.projectId);
  const addAsset = useEditorStore((s) => s.addAsset);
  const refreshAssets = useEditorStore((s) => s.refreshAssets);
  const addMediaToTimeline = useEditorStore((s) => s.addMediaToTimeline);
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mode, setMode] = useState<RecordMode>(initialMode);
  const [quality, setQuality] = useState('720p');
  const [fps, setFps] = useState(30);
  const [mirror, setMirror] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [state, setState] = useState<RecordingState>({
    mode: initialMode,
    stream: null,
    recorder: null,
    chunks: [],
    isRecording: false,
    elapsed: 0,
    error: null,
  });

  useEffect(() => {
    setMode(initialMode);
    setState((s) => ({ ...s, mode: initialMode }));
  }, [initialMode]);

  // Start preview stream when dialog opens
  const startPreview = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      let stream: MediaStream;
      if (mode === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...VIDEO_CONSTRAINTS[quality], frameRate: { ideal: fps } },
          audio: true,
        });
      } else if (mode === 'voice') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else if (mode === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { ...VIDEO_CONSTRAINTS[quality], frameRate: { ideal: fps } },
          audio: true,
        });
      } else {
        // camera + screen
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { ...VIDEO_CONSTRAINTS[quality], frameRate: { ideal: fps } },
          audio: true,
        });
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        // Combine: use display video + cam audio
        const combined = new MediaStream();
        displayStream.getVideoTracks().forEach((t) => combined.addTrack(t));
        camStream.getAudioTracks().forEach((t) => combined.addTrack(t));
        stream = combined;
      }
      setState((s) => ({ ...s, stream }));
      if (videoRef.current && mode !== 'voice') {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to access media devices';
      setState((s) => ({ ...s, error: msg }));
      toast.error(msg);
    }
  }, [mode, quality, fps]);

  // Stop preview stream
  const stopPreview = useCallback(() => {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
    }
    setState((s) => ({ ...s, stream: null, recorder: null, chunks: [], isRecording: false, elapsed: 0 }));
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [state.stream]);

  useEffect(() => {
    if (open) {
      startPreview();
    } else {
      stopPreview();
    }
    return () => stopPreview();
  }, [open, mode, quality, fps]);

  // Start recording with countdown
  const startRecording = () => {
    if (!state.stream) return;
    setCountdown(3);
    const cd = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(cd);
          actuallyStart();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const actuallyStart = () => {
    if (!state.stream) return;
    try {
      const mimeType = mode === 'voice'
        ? 'audio/webm'
        : 'video/webm;codecs=vp9,opus';
      const recorder = new MediaRecorder(state.stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        uploadRecording(blob, recorder.mimeType);
      };
      recorder.start(1000);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, elapsed: (Date.now() - startTime) / 1000 }));
      }, 100);
      setState((s) => ({ ...s, recorder, chunks, isRecording: true }));
      toast.success('Recording started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const stopRecording = () => {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState((s) => ({ ...s, isRecording: false }));
  };

  const uploadRecording = async (blob: Blob, mimeType: string) => {
    if (!projectId) { toast.error('No project open'); return; }
    toast.info('Uploading recording…');
    try {
      const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('audio') ? 'webm' : 'webm';
      const filename = `recording-${Date.now()}.${ext}`;
      const formData = new FormData();
      formData.append('file', blob, filename);
      formData.append('projectId', projectId);
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
      toast.success('Recording uploaded and added to media library');
      refreshAssets();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const modeLabel = {
    camera: 'Camera Recording',
    screen: 'Screen Recording',
    'camera+screen': 'Camera + Screen',
    voice: 'Voice Recording',
  }[mode];

  const ModeIcon = mode === 'camera' ? Camera : mode === 'screen' ? Monitor : mode === 'voice' ? Mic : Video;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!state.isRecording) { onOpenChange(o); } }}>
      <DialogContent className="max-w-2xl bg-card/95 border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ModeIcon className="h-4 w-4" /> {modeLabel}
          </DialogTitle>
        </DialogHeader>

        {state.error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Device access denied</p>
                <p className="text-xs text-muted-foreground mt-1">{state.error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={startPreview}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Retry
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Preview */}
            {mode !== 'voice' && (
              <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`w-full h-full object-contain ${mirror && mode === 'camera' ? 'scale-x-[-1]' : ''}`}
                />
                {countdown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <span className="text-6xl font-bold text-primary">{countdown}</span>
                  </div>
                )}
                {state.isRecording && (
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 backdrop-blur">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-mono text-white">{formatElapsed(state.elapsed)}</span>
                  </div>
                )}
              </div>
            )}
            {mode === 'voice' && (
              <div className="flex items-center justify-center h-32 rounded-lg bg-black">
                <Mic className={`h-12 w-12 ${state.isRecording ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`} />
              </div>
            )}

            {/* Settings */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Quality</Label>
                <Select value={quality} onValueChange={setQuality} disabled={state.isRecording}>
                  <SelectTrigger className="bg-background/60 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(VIDEO_CONSTRAINTS).map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frame rate</Label>
                <Select value={String(fps)} onValueChange={(v) => setFps(parseInt(v))} disabled={state.isRecording}>
                  <SelectTrigger className="bg-background/60 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FPS_OPTIONS.map((f) => <SelectItem key={f} value={String(f)}>{f} fps</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {mode === 'camera' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Mirror</Label>
                  <div className="flex items-center h-7">
                    <Switch checked={mirror} onCheckedChange={setMirror} disabled={state.isRecording} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {!state.isRecording ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={startRecording} disabled={!state.stream || !!state.error}>
                <Video className="h-4 w-4 mr-1.5" /> Start recording
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={stopRecording}>
              <Square className="h-4 w-4 mr-1.5" /> Stop & upload
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
