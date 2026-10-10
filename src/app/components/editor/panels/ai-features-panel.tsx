'use client';

// V19.1: AI Features Panel — highlight detection, shorts generation, auto-reframe.
// Uses the EXISTING engines (src/lib/ai/highlight-detection.ts, src/lib/render/auto-reframe.ts)
// via API calls so the processing happens server-side with real FFmpeg + AI.

import { useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Scissors, Smartphone, Play, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatTimecode } from '@/lib/timeline';

interface HighlightSegment {
  start: number;
  end: number;
  score: number;
  reason: string;
  title: string;
}

export function AiFeaturesPanel() {
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const openProject = useUIStore((s) => s.openProject);
  const [loading, setLoading] = useState<null | 'highlights' | 'shorts' | 'reframe'>(null);
  const [highlights, setHighlights] = useState<HighlightSegment[]>([]);
  const [reframeStatus, setReframeStatus] = useState<string | null>(null);

  // V19.1: Find the longest video clip as the "source" for highlight detection
  const sourceClip = clips
    .filter((c) => c.kind === 'video')
    .sort((a, b) => b.duration - a.duration)[0];
  const sourceAsset = sourceClip ? assets.find((a) => a.id === sourceClip.assetId) : null;

  const detectHighlights = useCallback(async () => {
    if (!sourceAsset) {
      toast.error('No video source available for highlight detection');
      return;
    }
    setLoading('highlights');
    try {
      const res = await fetch('/api/ai/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: sourceAsset.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHighlights(data.segments || []);
      toast.success(`Detected ${data.segments?.length || 0} highlight segments`);
    } catch (err) {
      toast.error('Highlight detection requires server-side processing');
      // V19.1: Honest fallback — don't fake results
      setHighlights([]);
    } finally {
      setLoading(null);
    }
  }, [sourceAsset]);

  const generateShort = useCallback(async (segment: HighlightSegment) => {
    setLoading('shorts');
    try {
      const res = await fetch('/api/ai/shorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: sourceAsset?.id,
          start: segment.start,
          end: segment.end,
          aspectRatio: '9:16',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.projectId) {
        toast.success(`Short project created`);
        openProject(data.projectId);
      }
    } catch (err) {
      toast.error('Short generation requires server-side processing');
    } finally {
      setLoading(null);
    }
  }, [sourceAsset, openProject]);

  const autoReframe = useCallback(async () => {
    if (!sourceAsset) {
      toast.error('No video source for auto-reframe');
      return;
    }
    setLoading('reframe');
    setReframeStatus(null);
    try {
      const res = await fetch('/api/ai/reframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: sourceAsset.id,
          targetAspect: '9:16',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReframeStatus(data.note || 'Auto-reframe keyframes generated');
      toast.success('Auto-reframe keyframes applied to clip');
    } catch (err) {
      // V19.1 §33: Honest about what's available
      setReframeStatus('Auto-reframe requires VISION_PROVIDER to be configured for subject-aware reframing. Center-crop fallback is available but is NOT subject tracking.');
      toast.error('Auto-reframe requires server-side vision provider');
    } finally {
      setLoading(null);
    }
  }, [sourceAsset]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Auto-Reframe */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Auto-Reframe</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Convert 16:9 video to 9:16, 1:1, or 4:5 with subject-aware framing.
        </p>
        <Button
          variant="outline" size="sm" className="w-full h-7 text-xs"
          disabled={!sourceAsset || loading !== null}
          onClick={autoReframe}
        >
          {loading === 'reframe' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Smartphone className="h-3 w-3 mr-1" />}
          Reframe to 9:16
        </Button>
        {reframeStatus && (
          <p className="text-[10px] text-amber-500/80 bg-amber-500/10 rounded px-2 py-1">
            {reframeStatus}
          </p>
        )}
      </div>

      <div className="h-px bg-border/40" />

      {/* Highlight Detection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">AI Highlights</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Analyze audio peaks, scene changes, + transcript to find highlights.
        </p>
        <Button
          variant="outline" size="sm" className="w-full h-7 text-xs"
          disabled={!sourceAsset || loading !== null}
          onClick={detectHighlights}
        >
          {loading === 'highlights' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
          Detect Highlights
        </Button>
        {highlights.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {highlights.map((seg, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-background/40 px-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate">{seg.title}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {formatTimecode(seg.start, 30, 'seconds')} - {formatTimecode(seg.end, 30, 'seconds')}
                    <span className="ml-2 text-primary/60">{seg.reason}</span>
                  </div>
                </div>
                <button
                  onClick={() => generateShort(seg)}
                  className="text-muted-foreground hover:text-primary shrink-0"
                  title="Create short"
                >
                  {loading === 'shorts' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!sourceAsset && (
        <p className="text-[10px] text-muted-foreground text-center">
          Add a video clip to the timeline to enable AI features.
        </p>
      )}
    </div>
  );
}
