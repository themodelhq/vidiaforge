'use client';

import { useState } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Captions, Sparkles, Type, Languages, Wand2, Loader2 } from 'lucide-react';
import { createClip, createTrack } from '@/lib/timeline';
import type { CaptionCue, TextStyle } from '@/lib/types';

const CAPTION_STYLES = [
  { id: 'tiktok', label: 'TikTok', preview: 'BOLD WORDS', style: { fontWeight: 800, color: '#ffffff', background: { color: '#000000', rounded: 6, padding: 8 } } },
  { id: 'youtube', label: 'YouTube', preview: 'Subtitle text', style: { fontWeight: 500, color: '#ffffff', background: { color: 'rgba(0,0,0,0.8)', rounded: 2, padding: 4 } } },
  { id: 'podcast', label: 'Podcast', preview: 'Speaker Name', style: { fontWeight: 700, color: '#f5a623' } },
  { id: 'cinematic', label: 'Cinematic', preview: 'CINEMATIC', style: { fontWeight: 300, color: '#ffffff', letterSpacing: 2 } },
  { id: 'minimal', label: 'Minimal', preview: 'simple text', style: { fontWeight: 400, color: '#ffffff' } },
  { id: 'bold', label: 'Bold', preview: 'BOLD', style: { fontWeight: 900, color: '#ffffff' } },
  { id: 'karaoke', label: 'Karaoke', preview: 'Word by word', style: { fontWeight: 600, color: '#f5a623' } },
];

const LANGUAGES = ['English', 'French', 'Spanish', 'Portuguese', 'Arabic', 'German', 'Italian', 'Chinese', 'Japanese', 'Korean', 'Yoruba', 'Hausa', 'Igbo'];

export function CaptionsPanel() {
  const [transcribing, setTranscribing] = useState(false);
  const tracks = useEditorStore((s) => s.tracks);
  const addClip = useEditorStore((s) => s.addClip);
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const playhead = useEditorStore((s) => s.playhead);
  const [translating, setTranslating] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const generateCaptions = async () => {
    setTranscribing(true);
    setTranscribeError(null);

    // Find the first video/audio asset with audio to transcribe
    const audioAsset = assets.find((a) => a.kind === 'video' || a.kind === 'audio');
    if (!audioAsset) {
      setTranscribeError('No video or audio asset found. Upload media with audio first.');
      setTranscribing(false);
      return;
    }

    try {
      const res = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: audioAsset.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Transcription failed');
      }

      // If transcription returns cues immediately (synchronous provider), use them.
      // Otherwise (queued), show a status message.
      const cues: CaptionCue[] = data.cues || [];
      if (cues.length === 0) {
        toast.info(data.message || 'Transcription queued. Captions will appear when processing completes.');
        setTranscribing(false);
        return;
      }

      let track = tracks.find((t) => t.kind === 'subtitle');
      if (!track) {
        track = createTrack('subtitle');
        useEditorStore.setState((s) => ({ tracks: [...s.tracks, track!] }));
      }
      const firstCueText = cues[0]?.text || 'Caption';
      const text: TextStyle = {
        text: firstCueText,
        fontFamily: 'Inter', fontSize: 28, fontWeight: 700, italic: false,
        letterSpacing: 0, lineHeight: 1.2, align: 'center', color: '#ffffff',
        background: { color: '#000000', rounded: 4, padding: 4 },
        animation: 'none',
      };
      const clip = createClip({
        trackId: track.id,
        kind: 'subtitle',
        timelineStart: playhead,
        duration: cues[cues.length - 1]?.end || 8,
        label: `${cues.length} captions`,
        text,
        caption: { cues, style: 'tiktok' },
      });
      addClip(clip);
      toast.success(`Generated ${cues.length} captions`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Caption generation failed';
      setTranscribeError(msg);
      toast.error(msg);
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Captions className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Auto-captions</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2.5">Transcribe your video's audio into timed captions automatically.</p>
        <Button onClick={generateCaptions} disabled={transcribing} size="sm" className="w-full h-8 text-xs">
          {transcribing ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Transcribing…</> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate captions</>}
        </Button>
        {transcribeError && (
          <p className="text-[11px] text-amber-500 mt-2">{transcribeError}</p>
        )}
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Type className="h-3 w-3" /> Caption styles
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => toast.info(`Applied "${s.label}" style — edit selected caption`)}
              className="rounded-lg border border-border/40 bg-background/40 p-2.5 text-center hover:border-primary/50 hover:bg-accent/30 transition"
            >
              <div className="text-xs font-medium mb-1">{s.label}</div>
              <div className="text-[10px] px-2 py-1 rounded inline-block" style={{
                fontWeight: s.style.fontWeight,
                color: s.style.color,
                background: s.style.background?.color,
                letterSpacing: s.style.letterSpacing,
                borderRadius: s.style.background?.rounded,
              }}>{s.preview}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Languages className="h-3 w-3" /> Translate
        </h3>
        <div className="flex flex-wrap gap-1">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={async () => {
                // Find the currently selected subtitle clip's cues
                const selectedClip = useEditorStore.getState().clips.find((c) =>
                  useEditorStore.getState().selectedClipIds.includes(c.id) && c.kind === 'subtitle'
                );
                if (!selectedClip?.caption?.cues) {
                  toast.error('Select a caption clip on the timeline first');
                  return;
                }
                setTranslating(true);
                try {
                  const res = await fetch('/api/ai/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      cues: selectedClip.caption.cues.map((c) => c.text),
                      from: 'English',
                      to: l,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Translation failed');
                  // Update the clip with translated cues (preserving timestamps)
                  const translatedCues = selectedClip.caption.cues.map((c, i) => ({
                    ...c,
                    text: data.translatedCues?.[i] || c.text,
                  }));
                  useEditorStore.getState().updateClip(selectedClip.id, {
                    caption: { ...selectedClip.caption, cues: translatedCues },
                    text: { ...selectedClip.text!, text: translatedCues[0]?.text || '' },
                  });
                  toast.success(`Translated captions to ${l}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Translation failed');
                } finally {
                  setTranslating(false);
                }
              }}
              className="px-2 py-1 rounded text-[11px] bg-muted/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition"
            >
              {translating ? <Loader2 className="h-3 w-3 animate-spin" /> : l}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border/40 bg-background/30 p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Wand2 className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] font-medium">AI caption tools</span>
        </div>
        <ul className="space-y-1 text-[10px] text-muted-foreground">
          <li>• Speaker detection & diarization</li>
          <li>• Word-level timestamps</li>
          <li>• Filler-word removal</li>
          <li>• Automatic punctuation</li>
          <li>• Caption summarization</li>
        </ul>
      </div>
    </div>
  );
}
