'use client';

import { useState, useRef, useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, Scissors, Captions,
  Film, Volume2, Smartphone, Clock, Zap,
} from 'lucide-react';
// V19 §42: import the CANONICAL executor instead of using a local applyCommands
// that only handled 4 of 17 command types.
import { executeCommands } from '@/lib/ai/command-engine/executor';

interface AICommand {
  type: string;
  [key: string]: unknown;
}
interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  commands?: AICommand[];
  pending?: boolean;
}

const SUGGESTIONS = [
  { icon: Wand2, text: 'Make this more cinematic' },
  { icon: Captions, text: 'Add captions' },
  { icon: Volume2, text: 'Remove all silence' },
  { icon: Clock, text: 'Create a 30-second version' },
  { icon: Smartphone, text: 'Create a TikTok version' },
  { icon: Scissors, text: 'Find the best moments' },
  { icon: Film, text: 'Create a trailer' },
  { icon: Zap, text: 'Make the music quieter when I speak' },
];

export function AiPanel() {
  const aiAssistantOpen = useUIStore((s) => s.aiAssistantOpen);
  const setAiAssistantOpen = useUIStore((s) => s.setAiAssistantOpen);
  const project = useEditorStore((s) => s.project);
  const clips = useEditorStore((s) => s.clips);
  const duration = useEditorStore((s) => s.duration);
  const updateClip = useEditorStore((s) => s.updateClip);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const [messages, setMessages] = useState<AIMessage[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m your AI editing assistant. Tell me what you want to do — I\'ll propose changes you can review and apply. I never destroy your work.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!aiAssistantOpen) return null;

  const send = async (prompt: string) => {
    if (!prompt.trim() || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          projectContext: {
            name: project?.name,
            duration,
            trackCount: useEditorStore.getState().tracks.length,
            clipCount: clips.length,
            canvasPreset: project?.canvasPreset,
          },
        }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: data.summary || 'Here are my proposed changes:',
          commands: data.commands ?? [],
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'I had trouble processing that. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // V19 §42: Use the CANONICAL executor from src/lib/ai/command-engine/executor.ts.
  // It handles all 17 command types (vs the previous local version which only
  // handled 4: apply_filter, adjust_color, add_vignette, increase_speed).
  // The canonical executor wraps everything in a single history entry.
  const applyCommands = (commands: AICommand[]) => {
    try {
      const report = executeCommands(commands as any, useEditorStore);
      if (report.applied > 0) {
        toast.success(`Applied ${report.applied} change${report.applied === 1 ? '' : 's'}`);
      }
      if (report.skipped > 0) {
        toast.message(`Skipped ${report.skipped} command${report.skipped === 1 ? '' : 's'} (no matching clip or unsupported)`);
      }
      if (report.errors.length > 0) {
        console.warn('[ai-panel] execution errors:', report.errors);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply AI commands');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAiAssistantOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full sm:max-w-2xl h-[80vh] sm:h-[600px] bg-card border border-border/60 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent">
          <div className="relative h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">VidiaForge AI</h3>
            <p className="text-[11px] text-muted-foreground">Previewable · Reversible · Non-destructive</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAiAssistantOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 scrollbar-thin">
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/60'} rounded-2xl px-3.5 py-2.5`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.commands && msg.commands.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[11px] opacity-70 font-medium">AI proposed {msg.commands.length} change{msg.commands.length === 1 ? '' : 's'}:</div>
                      <div className="space-y-1">
                        {msg.commands.map((cmd, j) => (
                          <div key={j} className="rounded-md bg-background/40 px-2.5 py-1.5 text-[11px] font-mono">
                            <span className="text-primary">{cmd.type}</span>
                            {Object.entries(cmd).filter(([k]) => k !== 'type').map(([k, v]) => (
                              <span key={k} className="text-muted-foreground ml-2">{k}={String(v)}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <Button size="sm" className="h-7 text-xs" onClick={() => applyCommands(msg.commands!)}>
                          <Check className="h-3 w-3 mr-1" /> Apply all
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.info('Review mode — coming soon')}>
                          Review
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted/60 rounded-2xl px-3.5 py-2.5 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div className="px-3 py-2 border-t border-border/50 flex gap-1.5 overflow-x-auto scrollbar-thin">
            {SUGGESTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.text}
                  onClick={() => send(s.text)}
                  className="shrink-0 flex items-center gap-1.5 rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[11px] hover:bg-accent/50 transition"
                >
                  <Icon className="h-3 w-3 text-primary" />
                  {s.text}
                </button>
              );
            })}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-border/50 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask AI to edit your video…"
            className="flex-1 bg-background/60 rounded-full px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/40"
          />
          <Button size="icon" className="rounded-full h-9 w-9 shrink-0" onClick={() => send(input)} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
