'use client';

// V19.1: Text-Based Editing Panel — transcript-driven timeline editing.
// Uses the existing text-editing engine (src/lib/ai/text-editing.ts) to
// delete words/sentences/silence/filler words from the timeline.

import { useState, useMemo, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Trash2, Eraser, VolumeX, MicOff, Loader2, FileText,
} from 'lucide-react';
import { formatTimecode } from '@/lib/timeline';
import { toast } from 'sonner';
import type { CaptionCue } from '@/lib/types';

export function TranscriptPanel() {
  const clips = useEditorStore((s) => s.clips);
  const updateClip = useEditorStore((s) => s.updateClip);
  const updateClipSilent = useEditorStore((s) => s.updateClipSilent);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const [processing, setProcessing] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);

  // V19.1: Find the clip with caption cues data
  const captionClip = clips.find((c) => c.caption?.cues && c.caption.cues.length > 0);
  const cues = captionClip?.caption?.cues || [];

  const deleteSentence = useCallback(async (cue: CaptionCue) => {
    if (!captionClip) return;
    setProcessing(true);
    try {
      // V19.1: Use the PRODUCTION text-editing engine
      const { deleteTranscriptRange } = await import('@/lib/ai/text-editing');
      const result = deleteTranscriptRange(
        clips,
        captionClip.id,
        cue.start,
        cue.end,
        `sentence: "${cue.text.substring(0, 30)}..."`,
      );
      pushHistory('Delete sentence');
      // Update all affected clips
      result.clips.forEach((c) => {
        if (c.id === captionClip.id || c.id.startsWith(captionClip.id + '_')) {
          updateClipSilent(c.id, c);
        }
      });
      toast.success(`Deleted ${result.removedDuration.toFixed(1)}s from timeline`);
    } catch (err) {
      toast.error('Failed to delete sentence');
    } finally {
      setProcessing(false);
    }
  }, [captionClip, clips, pushHistory, updateClipSilent]);

  const deleteSilence = useCallback(async () => {
    if (!captionClip || cues.length < 2) return;
    setProcessing(true);
    try {
      const { deleteSilence } = await import('@/lib/ai/text-editing');
      const result = deleteSilence(clips, captionClip, cues);
      pushHistory('Delete silence');
      result.clips.forEach((c) => {
        if (c.id === captionClip.id || c.id.startsWith(captionClip.id + '_')) {
          updateClipSilent(c.id, c);
        }
      });
      toast.success(result.description);
    } catch (err) {
      toast.error('Failed to remove silence');
    } finally {
      setProcessing(false);
    }
  }, [captionClip, clips, cues, pushHistory, updateClipSilent]);

  const deleteFillers = useCallback(async () => {
    if (!captionClip) return;
    setProcessing(true);
    try {
      const { deleteFillerWords } = await import('@/lib/ai/text-editing');
      const result = deleteFillerWords(clips, captionClip, cues);
      pushHistory('Delete filler words');
      result.clips.forEach((c) => {
        if (c.id === captionClip.id || c.id.startsWith(captionClip.id + '_')) {
          updateClipSilent(c.id, c);
        }
      });
      toast.success(result.description);
    } catch (err) {
      toast.error('Failed to remove filler words');
    } finally {
      setProcessing(false);
    }
  }, [captionClip, clips, cues, pushHistory, updateClipSilent]);

  if (!captionClip) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <FileText className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">
          No transcript available. Generate captions on a video clip to enable text-based editing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex gap-1">
        <Button
          variant="outline" size="sm" className="flex-1 h-7 text-xs"
          disabled={processing} onClick={deleteSilence}
        >
          <VolumeX className="h-3 w-3 mr-1" /> Silence
        </Button>
        <Button
          variant="outline" size="sm" className="flex-1 h-7 text-xs"
          disabled={processing} onClick={deleteFillers}
        >
          <MicOff className="h-3 w-3 mr-1" /> Fillers
        </Button>
      </div>

      {processing && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <ScrollArea className="max-h-80">
        <div className="space-y-1">
          {cues.map((cue) => (
            <div
              key={cue.id}
              className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 cursor-pointer transition ${
                selectedCueId === cue.id ? 'bg-primary/15' : 'hover:bg-muted/40'
              }`}
              onClick={() => {
                setSelectedCueId(cue.id);
                if (captionClip) setPlayhead(captionClip.timelineStart + cue.start);
              }}
            >
              <span className="font-mono text-[9px] text-muted-foreground mt-0.5 shrink-0">
                {formatTimecode(cue.start, 30, 'seconds')}
              </span>
              <span className="text-[11px] flex-1 leading-relaxed">{cue.text}</span>
              {cue.speaker && (
                <span className="text-[9px] text-primary/70 shrink-0">{cue.speaker}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); deleteSentence(cue); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
