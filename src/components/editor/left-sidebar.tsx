'use client';

import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Film, Music, Type, Captions, Sticker, Sparkles, Wand2, Palette,
  ArrowLeftRight, LayoutTemplate, Box, Brush, PanelLeftClose,
  Activity, FileText, Scissors,
} from 'lucide-react';
import { MediaPanel } from '@/components/editor/panels/media-panel';
import { AudioPanel } from '@/components/editor/panels/audio-panel';
import { TextPanel } from '@/components/editor/panels/text-panel';
import { CaptionsPanel } from '@/components/editor/panels/captions-panel';
import { StickersPanel } from '@/components/editor/panels/stickers-panel';
import { EffectsPanel } from '@/components/editor/panels/effects-panel';
import { FiltersPanel } from '@/components/editor/panels/filters-panel';
import { TransitionsPanel } from '@/components/editor/panels/transitions-panel';
import { TemplatesPanel } from '@/components/editor/panels/templates-panel';
import { AiPanel } from '@/components/editor/panels/ai-panel';
import { BrandKitPanel } from '@/components/editor/panels/brand-kit-panel';
import { ElementsPanel } from '@/components/editor/panels/elements-panel';
// V19.1: New panels for previously-PARTIAL features
import { ColorScopesPanel } from '@/components/editor/panels/color-scopes-panel';
import { TranscriptPanel } from '@/components/editor/panels/transcript-panel';
import { AiFeaturesPanel } from '@/components/editor/panels/ai-features-panel';

interface TabDef {
  id: string;
  label: string;
  icon: React.ElementType;
  component: React.ComponentType;
}

const TABS: TabDef[] = [
  { id: 'media', label: 'Media', icon: Film, component: MediaPanel },
  { id: 'audio', label: 'Audio', icon: Music, component: AudioPanel },
  { id: 'text', label: 'Text', icon: Type, component: TextPanel },
  { id: 'captions', label: 'Captions', icon: Captions, component: CaptionsPanel },
  { id: 'stickers', label: 'Stickers', icon: Sticker, component: StickersPanel },
  { id: 'effects', label: 'Effects', icon: Sparkles, component: EffectsPanel },
  { id: 'filters', label: 'Filters', icon: Wand2, component: FiltersPanel },
  { id: 'transitions', label: 'Transitions', icon: ArrowLeftRight, component: TransitionsPanel },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, component: TemplatesPanel },
  { id: 'ai', label: 'AI', icon: Brush, component: AiPanel },
  { id: 'scopes', label: 'Scopes', icon: Activity, component: ColorScopesPanel },
  { id: 'transcript', label: 'Transcript', icon: FileText, component: TranscriptPanel },
  { id: 'ai-features', label: 'AI Tools', icon: Scissors, component: AiFeaturesPanel },
  { id: 'brandkit', label: 'Brand Kit', icon: Palette, component: BrandKitPanel },
  { id: 'elements', label: 'Elements', icon: Box, component: ElementsPanel },
];

const ICON_TABS = TABS.slice(0, 9); // first 9 as icon-only rail
const BOTTOM_TABS = TABS.slice(9);

export function LeftSidebar() {
  const activeTab = useUIStore((s) => s.activeSidebarTab);
  const setActiveTab = useUIStore((s) => s.setActiveSidebarTab);
  const collapsed = useUIStore((s) => s.leftSidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleLeftSidebar);

  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.component ?? MediaPanel;
  const activeDef = TABS.find((t) => t.id === activeTab);

  return (
    <div className="flex h-full shrink-0 border-r border-border/60 bg-editor-panel">
      {/* Icon rail */}
      <nav className="flex w-14 flex-col items-center gap-1 py-2 border-r border-border/40 bg-editor-panel-elevated">
        {ICON_TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                  aria-label={tab.label}
                  aria-pressed={active}
                >
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary" />}
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>{tab.label}</TooltipContent>
            </Tooltip>
          );
        })}

        <div className="my-1 h-px w-7 bg-border/40" />

        {BOTTOM_TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                  aria-label={tab.label}
                >
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary" />}
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>{tab.label}</TooltipContent>
            </Tooltip>
          );
        })}

        <div className="mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground transition"
                aria-label="Collapse panel"
              >
                <PanelLeftClose className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>Collapse panel</TooltipContent>
          </Tooltip>
        </div>
      </nav>

      {/* Panel content */}
      {!collapsed && (
        <div className="flex w-72 flex-col min-h-0">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {activeDef?.label}
            </h2>
          </div>
          <ScrollArea className="flex-1 scrollbar-thin">
            <ActiveComponent />
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
