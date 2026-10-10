'use client';

import { useMemo, useState } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  detail?: string;
}

export function ProjectDiagnostics() {
  const project = useEditorStore((s) => s.project);
  const assets = useEditorStore((s) => s.assets);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const duration = useEditorStore((s) => s.duration);
  const [refreshing, setRefreshing] = useState(false);

  const checks = useMemo<HealthCheck[]>(() => {
    const results: HealthCheck[] = [];

    results.push({
      name: 'Project',
      status: project ? 'ok' : 'error',
      detail: project ? `${project.name} · ${project.width}×${project.height} · ${project.fps}fps` : 'No project loaded',
    });

    const timelineValid = tracks.length > 0;
    results.push({
      name: 'Timeline',
      status: timelineValid ? 'ok' : 'warning',
      detail: `${tracks.length} tracks · ${clips.length} clips · ${duration.toFixed(1)}s`,
    });

    const clipAssetIds = clips.map((c) => c.assetId).filter(Boolean) as string[];
    const missingAssets = clipAssetIds.filter((id) => !assets.find((a) => a.id === id));
    results.push({
      name: 'Media available',
      status: missingAssets.length === 0 ? 'ok' : 'error',
      detail: missingAssets.length === 0
        ? `All ${clipAssetIds.length} referenced assets available`
        : `${missingAssets.length} missing asset(s)`,
    });

    const notReadyAssets = assets.filter((a) => a.status && a.status !== 'ready');
    results.push({
      name: 'Media ready',
      status: notReadyAssets.length === 0 ? 'ok' : 'warning',
      detail: notReadyAssets.length === 0
        ? `All ${assets.length} assets processed`
        : `${notReadyAssets.length} asset(s) still processing or failed`,
    });

    const videoAssets = assets.filter((a) => a.kind === 'video');
    const assetsWithThumb = videoAssets.filter((a) => a.thumbnailUrl);
    results.push({
      name: 'Thumbnails',
      status: videoAssets.length === 0 ? 'ok' : assetsWithThumb.length === videoAssets.length ? 'ok' : 'warning',
      detail: videoAssets.length === 0 ? 'No video assets' : `${assetsWithThumb.length}/${videoAssets.length} have thumbnails`,
    });

    const hasAudio = clips.some((c) => c.kind === 'audio' || c.kind === 'video');
    results.push({
      name: 'Audio',
      status: hasAudio ? 'ok' : 'warning',
      detail: hasAudio ? 'Audio track present' : 'No audio clips',
    });

    const captionClips = clips.filter((c) => c.kind === 'subtitle');
    results.push({
      name: 'Captions',
      status: 'ok',
      detail: captionClips.length === 0 ? 'No captions' : `${captionClips.length} caption clip(s)`,
    });

    results.push({
      name: 'Render settings',
      status: project ? 'ok' : 'warning',
      detail: project ? `${project.resolution} · ${project.fps}fps` : 'No project',
    });

    return results;
  }, [project, assets, clips, tracks, duration]);

  const okCount = checks.filter((c) => c.status === 'ok').length;
  const warnCount = checks.filter((c) => c.status === 'warning').length;
  const errCount = checks.filter((c) => c.status === 'error').length;

  const handleRefresh = () => {
    setRefreshing(true);
    useEditorStore.getState().refreshAssets();
    useEditorStore.getState().refreshRenderJobs();
    setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Project Health</h3>
          <p className="text-[11px] text-muted-foreground">
            {okCount} ok · {warnCount} warnings · {errCount} errors
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="space-y-1.5">
        {checks.map((check) => {
          const Icon = check.status === 'ok' ? CheckCircle2 : check.status === 'warning' ? AlertTriangle : XCircle;
          const color = check.status === 'ok' ? 'text-emerald-500' : check.status === 'warning' ? 'text-amber-500' : 'text-destructive';
          return (
            <div key={check.name} className="flex items-center gap-2 text-xs">
              <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
              <span className="font-medium min-w-24">{check.name}</span>
              <span className="text-muted-foreground truncate flex-1">{check.detail}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
