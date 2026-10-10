'use client';

// V19.1: Color Scopes Panel — Waveform/RGB Parade/Vectorscope/Histogram
// Uses the REAL color scope engine (src/lib/render/color-scopes.ts) to compute
// scope data from actual video frame pixels via FFmpeg frame extraction.

import { useState, useRef, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { Button } from '@/components/ui/button';
import { Loader2, Activity, BarChart3, Circle, Waves } from 'lucide-react';

type ScopeType = 'waveform' | 'rgb-parade' | 'vectorscope' | 'histogram';

const SCOPES: { type: ScopeType; label: string; icon: typeof Activity }[] = [
  { type: 'waveform', label: 'Waveform', icon: Activity },
  { type: 'rgb-parade', label: 'RGB Parade', icon: BarChart3 },
  { type: 'vectorscope', label: 'Vectorscope', icon: Circle },
  { type: 'histogram', label: 'Histogram', icon: Waves },
];

export function ColorScopesPanel() {
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const playhead = useEditorStore((s) => s.playhead);
  const [activeScope, setActiveScope] = useState<ScopeType>('waveform');
  const [loading, setLoading] = useState(false);
  const [scopeData, setScopeData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // V19.1: Find the current video clip at playhead
  const activeClip = clips.find((c) =>
    (c.kind === 'video' || c.kind === 'image') &&
    playhead >= c.timelineStart &&
    playhead < c.timelineStart + c.duration,
  );

  const refreshScope = useCallback(async () => {
    if (!activeClip?.assetId) {
      setError('No active video clip at playhead');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // V19.1: Call the API to get scope data (server-side frame extraction + analysis)
      const timeInClip = playhead - activeClip.timelineStart;
      const res = await fetch('/api/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: activeClip.assetId, time: timeInClip }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setScopeData(data);
      // V19.1: Draw the scope on canvas
      drawScope(activeScope, data, canvasRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute scopes');
    } finally {
      setLoading(false);
    }
  }, [activeClip, playhead, activeScope]);

  const switchScope = (type: ScopeType) => {
    setActiveScope(type);
    if (scopeData) drawScope(type, scopeData, canvasRef.current);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.type}
            onClick={() => switchScope(s.type)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] transition ${
              activeScope === s.type ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground hover:bg-accent/50'
            }`}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      <Button size="sm" className="w-full h-7 text-xs" disabled={!activeClip || loading} onClick={refreshScope}>
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        {loading ? 'Analyzing...' : 'Refresh Scope'}
      </Button>

      {error && <p className="text-[10px] text-destructive text-center">{error}</p>}

      {activeClip ? (
        <div className="rounded-lg border border-border/40 bg-black/40 overflow-hidden">
          <canvas ref={canvasRef} width={260} height={160} className="w-full h-auto" />
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center py-4">
          Position playhead over a video clip to analyze.
        </p>
      )}
    </div>
  );
}

// V19.1: Draw the scope on a canvas using the computed pixel data
function drawScope(type: ScopeType, data: any, canvas: HTMLCanvasElement | null) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  if (type === 'waveform' && data.waveform) {
    const { buckets, maxCount } = data.waveform;
    const barW = W / buckets.length;
    ctx.fillStyle = '#00ff88';
    for (let i = 0; i < buckets.length; i++) {
      const h = (buckets[i] / maxCount) * H;
      ctx.fillRect(i * barW, H - h, barW - 0.5, h);
    }
  } else if (type === 'histogram' && data.histogram) {
    const { red, green, blue, maxCount } = data.histogram;
    const barW = W / 256;
    for (let i = 0; i < 256; i++) {
      const rH = (red[i] / maxCount) * H;
      const gH = (green[i] / maxCount) * H;
      const bH = (blue[i] / maxCount) * H;
      ctx.fillStyle = 'rgba(255,60,60,0.5)';
      ctx.fillRect(i * barW, H - rH, barW, rH);
      ctx.fillStyle = 'rgba(60,255,60,0.5)';
      ctx.fillRect(i * barW, H - gH, barW, gH);
      ctx.fillStyle = 'rgba(60,60,255,0.5)';
      ctx.fillRect(i * barW, H - bH, barW, bH);
    }
  } else if (type === 'rgb-parade' && data.rgbParade) {
    const channels = [
      { data: data.rgbParade.red, color: 'rgba(255,60,60,0.6)' },
      { data: data.rgbParade.green, color: 'rgba(60,255,60,0.6)' },
      { data: data.rgbParade.blue, color: 'rgba(60,60,255,0.6)' },
    ];
    const segW = W / 3;
    channels.forEach((ch, ci) => {
      const { buckets, maxCount } = ch.data;
      const barW = segW / buckets.length;
      ctx.fillStyle = ch.color;
      for (let i = 0; i < buckets.length; i++) {
        const h = (buckets[i] / maxCount) * H;
        ctx.fillRect(ci * segW + i * barW, H - h, barW - 0.3, h);
      }
    });
  } else if (type === 'vectorscope' && data.vectorscope) {
    const { bins, maxBinCount } = data.vectorscope;
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) / 2 - 4;
    for (let r = 0; r < bins.length; r++) {
      for (let c = 0; c < bins[r].length; c++) {
        const count = bins[r][c];
        if (count === 0) continue;
        const angle = (r / bins.length) * Math.PI * 2;
        const mag = (c / bins[r].length) * radius;
        const x = cx + Math.cos(angle) * mag;
        const y = cy + Math.sin(angle) * mag;
        const alpha = Math.min(1, count / maxBinCount);
        ctx.fillStyle = `rgba(255,200,0,${alpha})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // Draw the I/Q axis reference circle
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}
