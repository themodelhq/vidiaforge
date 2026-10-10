'use client';

/* VidiaForge — Landing Page
 * A single client component file containing all 11 landing sections.
 * Sub-components are declared inline (local function components) for cohesion.
 * Design: cinematic dark-first, warm amber accent, premium & professional.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Layers,
  Captions,
  Wand2,
  Palette,
  Spline,
  AudioLines,
  Scissors,
  Eraser,
  ScanFace,
  Crop,
  Monitor,
  Download,
  Play,
  Menu,
  Check,
  ArrowRight,
  ChevronRight,
  Sparkles,
  Zap,
  Globe,
  CircleCheck,
  Smartphone,
  ShieldCheck,
  CreditCard,
  Film,
  Type,
  Volume2,
  Video,
  Clock,
  HardDrive,
  Languages,
  Mic,
  FlaskConical,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const stagger: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemFade: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function scrollToId(id: string) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goRegister() {
  useUIStore.getState().setView('register');
}
function goLogin() {
  useUIStore.getState().setView('login');
}

/* ------------------------------------------------------------------ */
/*  Logo                                                               */
/* ------------------------------------------------------------------ */

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 512 512"
        className="size-7 shrink-0"
        aria-hidden="true"
        role="img"
      >
        <defs>
          <linearGradient id="vf-logo-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0a0a0f" />
            <stop offset="100%" stopColor="#16161f" />
          </linearGradient>
          <linearGradient id="vf-logo-accent" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5a623" />
            <stop offset="100%" stopColor="#e07b1a" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="112" fill="url(#vf-logo-bg)" />
        <g transform="translate(256 256)">
          <circle r="140" fill="none" stroke="url(#vf-logo-accent)" strokeWidth="14" opacity="0.9" />
          <path d="M -52 -78 L 92 0 L -52 78 Z" fill="url(#vf-logo-accent)" />
          <g
            stroke="url(#vf-logo-accent)"
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            opacity="0.75"
          >
            <path d="M -150 -40 L -150 -90 L -100 -90" />
            <path d="M 150 -40 L 150 -90 L 100 -90" />
            <path d="M -150 40 L -150 90 L -100 90" />
            <path d="M 150 40 L 150 90 L 100 90" />
          </g>
        </g>
      </svg>
      <span className="text-base font-semibold tracking-tight text-foreground">
        Vidia<span className="text-primary">Forge</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Navigation Bar                                                  */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { label: 'Features', id: 'features' },
  { label: 'AI Tools', id: 'ai-tools' },
  { label: 'Templates', id: 'templates' },
  { label: 'Pricing', id: 'pricing' },
  { label: 'FAQ', id: 'faq' },
];

function NavBar() {
  const [open, setOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installEvt) return;
    await installEvt.prompt();
    await installEvt.userChoice;
    setInstallEvt(null);
  }, [installEvt]);

  const handleNav = (id: string) => {
    setOpen(false);
    scrollToId(id);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b border-border/60',
        'glass'
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => scrollToId('top')}
          aria-label="VidiaForge home"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Logo />
        </button>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => handleNav(link.id)}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </button>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 md:flex">
          {installEvt && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInstall}
              className="gap-2"
            >
              <Download className="size-4" />
              Install app
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={goLogin}>
            Sign in
          </Button>
          <Button size="sm" onClick={goRegister} className="gap-1.5">
            Start editing — free
            <ArrowRight className="size-3.5" />
          </Button>
        </div>

        {/* Mobile hamburger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>
                <Logo />
              </SheetTitle>
            </SheetHeader>
            <nav
              aria-label="Mobile"
              className="mt-2 flex flex-col gap-1 px-4"
            >
              {NAV_LINKS.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => handleNav(link.id)}
                  className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                  <ChevronRight className="size-4" />
                </button>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2 px-4">
              {installEvt && (
                <Button variant="outline" onClick={handleInstall} className="gap-2">
                  <Download className="size-4" />
                  Install app
                </Button>
              )}
              <Button variant="ghost" onClick={goLogin}>
                Sign in
              </Button>
              <Button onClick={goRegister} className="gap-1.5">
                Start editing — free
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
            <SheetClose className="sr-only">Close</SheetClose>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Hero Section                                                    */
/* ------------------------------------------------------------------ */

function HeroMockEditor() {
  return (
    <div className="relative w-full">
      {/* Soft amber glow behind the mock */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-10 rounded-[2rem] bg-primary/10 blur-3xl"
      />
      <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 p-0 shadow-2xl backdrop-blur-sm">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border/60 bg-editor-panel-elevated px-4 py-2.5">
          <span className="size-3 rounded-full bg-red-500/70" />
          <span className="size-3 rounded-full bg-yellow-500/70" />
          <span className="size-3 rounded-full bg-green-500/70" />
          <div className="ml-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Film className="size-3.5 text-primary" />
            <span className="font-mono">project_v3.vfp</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              1080p · 30fps
            </Badge>
          </div>
        </div>

        {/* Preview canvas */}
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {/* Cinematic gradient stand-in for video preview */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, oklch(0.5 0.16 45 / 0.55), transparent 60%), radial-gradient(circle at 70% 70%, oklch(0.4 0.18 25 / 0.45), transparent 55%), linear-gradient(135deg, #1a1410 0%, #0a0a0f 100%)',
            }}
          />
          {/* Subtle film grain pattern */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 3px)',
            }}
          />
          {/* Letterbox bars */}
          <div className="absolute inset-x-0 top-0 h-[8%] bg-black" />
          <div className="absolute inset-x-0 bottom-0 h-[8%] bg-black" />
          {/* Center play affordance */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-sm">
              <Play className="size-6 fill-primary text-primary" />
            </div>
          </div>
          {/* Top-left HUD */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur-sm">
              00:00:12:18
            </span>
          </div>
          {/* Bottom-right HUD */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur-sm">
              4K · H.264
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-1.5 bg-editor-panel p-3">
          {/* Ruler */}
          <div className="flex items-center justify-between px-1 pb-1 text-[10px] font-mono text-muted-foreground">
            <span>0:00</span>
            <span>0:05</span>
            <span>0:10</span>
            <span>0:15</span>
            <span>0:20</span>
            <span>0:25</span>
          </div>
          {/* Track: video */}
          <div className="relative flex h-7 items-center gap-1">
            <div className="flex h-full w-[35%] items-center rounded bg-[oklch(0.5_0.16_45)] px-2">
              <span className="truncate text-[10px] font-medium text-black/80">Intro.mp4</span>
            </div>
            <div className="flex h-full w-[45%] items-center rounded bg-[oklch(0.55_0.14_45)] px-2">
              <span className="truncate text-[10px] font-medium text-black/80">Main_take.mp4</span>
            </div>
            <div className="flex h-full w-[15%] items-center rounded bg-[oklch(0.45_0.18_25)] px-2">
              <span className="truncate text-[10px] font-medium text-black/80">Outro</span>
            </div>
          </div>
          {/* Track: text */}
          <div className="relative flex h-5 items-center gap-1 pl-[10%]">
            <div className="flex h-full w-[28%] items-center rounded bg-[oklch(0.55_0.16_300)] px-2">
              <span className="truncate text-[9px] font-medium text-white/90">Title — “VidiaForge”</span>
            </div>
            <div className="flex h-full w-[20%] items-center rounded bg-[oklch(0.55_0.16_300)] px-2">
              <span className="truncate text-[9px] font-medium text-white/90">Subtitle</span>
            </div>
          </div>
          {/* Track: audio */}
          <div className="relative flex h-5 items-center gap-1">
            <div
              className="flex h-full w-[90%] items-center overflow-hidden rounded bg-[oklch(0.55_0.14_160)] px-2"
            >
              <span className="flex items-center gap-1 truncate text-[9px] font-medium text-black/80">
                <Volume2 className="size-2.5" />
                soundtrack.wav
              </span>
              <span
                aria-hidden="true"
                className="ml-auto flex h-full flex-1 items-center gap-[1.5px]"
              >
                {Array.from({ length: 40 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[2px] bg-black/40"
                    style={{ height: `${20 + Math.abs(Math.sin(i * 0.7)) * 70}%` }}
                  />
                ))}
              </span>
            </div>
          </div>
          {/* Amber playhead overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-[42%] top-2 bottom-2 w-px bg-primary"
            style={{ boxShadow: '0 0 8px oklch(0.78 0.17 70 / 0.7)' }}
          >
            <span className="absolute -top-1.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary" />
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between border-t border-border/60 bg-editor-panel-elevated px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded bg-accent text-primary">
              <Sparkles className="size-3.5" />
            </span>
            <span className="text-[10px] text-muted-foreground">AI suggested 4 edits</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[68%] bg-primary" />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">68%</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function HeroSection() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-grid"
      aria-label="VidiaForge hero"
    >
      {/* Soft amber radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, oklch(0.78 0.17 70 / 0.15), transparent 70%)',
        }}
      />
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8 lg:py-28">
        {/* Left: copy */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-start gap-6"
        >
          <motion.div variants={itemFade}>
            <Badge variant="secondary" className="gap-1.5 border-border/60 bg-card/60 px-3 py-1 text-primary backdrop-blur-sm">
              <Sparkles className="size-3.5" />
              AI-powered, browser-native, installable
            </Badge>
          </motion.div>

          <motion.h1
            variants={itemFade}
            className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
          >
            Professional video editing.{' '}
            <span className="text-gradient-cinematic">In your browser.</span>
          </motion.h1>

          <motion.p
            variants={itemFade}
            className="max-w-xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            A cinematic, timeline-based editor with AI captions, transitions,
            color grading, and one-click exports. No download. Works on desktop
            and mobile. Installable as a PWA.
          </motion.p>

          <motion.div
            variants={itemFade}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button size="lg" onClick={goRegister} className="gap-2">
              Start editing — free
              <ArrowRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => scrollToId('workflow')}
              className="gap-2"
            >
              <Play className="size-4" />
              Watch demo
            </Button>
          </motion.div>

          {/* Trust badges */}
          <motion.ul
            variants={itemFade}
            className="flex flex-col gap-2.5 pt-4 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5"
          >
            <li className="flex items-center gap-1.5">
              <CreditCard className="size-3.5 text-primary" />
              No credit card required
            </li>
            <li className="flex items-center gap-1.5">
              <Globe className="size-3.5 text-primary" />
              Works on Chrome, Safari, Firefox, Edge
            </li>
            <li className="flex items-center gap-1.5">
              <Download className="size-3.5 text-primary" />
              Installable PWA
            </li>
          </motion.ul>
        </motion.div>

        {/* Right: mock editor */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="w-full"
        >
          <HeroMockEditor />
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Stats Strip                                                     */
/* ------------------------------------------------------------------ */

const STATS = [
  { value: '50+', label: 'editing features' },
  { value: '4K', label: 'export' },
  { value: '13+', label: 'languages' },
  { value: '< 3s', label: 'editor open' },
];

function StatsStrip() {
  return (
    <section aria-label="VidiaForge at a glance" className="border-y border-border/60 bg-card/30">
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto grid w-full max-w-7xl grid-cols-2 divide-x divide-border/60 px-4 sm:px-6 lg:grid-cols-4 lg:px-8"
      >
        {STATS.map((s) => (
          <motion.div
            key={s.label}
            variants={itemFade}
            className="flex flex-col items-center gap-1 px-4 py-8 text-center"
          >
            <span className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              <span className="text-gradient-cinematic">{s.value}</span>
            </span>
            <span className="text-xs text-muted-foreground sm:text-sm">{s.label}</span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Features Grid (Bento)                                          */
/* ------------------------------------------------------------------ */

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  span?: 'sm' | 'md' | 'lg';
}

const FEATURES: Feature[] = [
  { icon: Layers, title: 'Multi-track timeline', desc: 'Unlimited video, audio, text, and effect tracks with magnetic snapping and ripple edits.' },
  { icon: Captions, title: 'AI captions & translation', desc: 'Auto-transcribe speech, translate to 13+ languages, and burn in or export as SRT.' },
  { icon: Wand2, title: '16+ transitions', desc: 'Cross-dissolve, whip-pan, glitch, film-burn, morph — and a real curve editor.' },
  { icon: Palette, title: 'Color grading & LUTs', desc: 'Lift, gamma, gain, temperature, hue vs. luminance — and drop-in .cube LUTs.' },
  { icon: Spline, title: 'Keyframe animation', desc: 'Animate transform, opacity, color, and effects with bezier easing.' },
  { icon: AudioLines, title: 'Audio ducking & cleanup', desc: 'Auto-duck music under voice, denoise, normalize, and master to LUFS targets.' },
  { icon: Scissors, title: 'Green screen / chroma key', desc: 'One-click chroma key with spill suppression and soft edge feathering.' },
  { icon: Eraser, title: 'Background removal', desc: 'AI background removal for talking-head and product shots — no green screen required.' },
  { icon: ScanFace, title: 'Object & face tracking', desc: 'Track faces and objects through the timeline; attach masks, text, or effects.' },
  { icon: Crop, title: 'Auto-reframe to 9:16', desc: 'Reframe landscape footage to vertical, square, or 4:5 — keeping the subject centered.' },
  { icon: Monitor, title: 'Screen & camera recording', desc: 'Record screen, webcam, or both — straight into a new project timeline.' },
  { icon: Download, title: 'Export to MP4 / WebM', desc: 'H.264, H.265, VP9, AV1. Bitrate, CRF, and resolution controls. Queue multiple exports.' },
];

function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Everything a professional editor needs.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            A complete timeline studio — the kind you would expect from a desktop NLE — running entirely in your browser.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {FEATURES.map((f) => (
            <motion.div key={f.title} variants={itemFade}>
              <Card className="group h-full gap-4 border-border/60 bg-card/60 backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-card">
                <CardContent className="flex flex-col gap-3 px-5 py-5">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                    <f.icon className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  5. AI Tools Showcase                                               */
/* ------------------------------------------------------------------ */

interface AITool {
  prompt: string;
  changes: number;
  icon: React.ComponentType<{ className?: string }>;
  tag: string;
}

const AI_TOOLS: AITool[] = [
  { prompt: 'Remove all silence.', changes: 7, icon: Scissors, tag: 'silence removal' },
  { prompt: 'Make this more cinematic.', changes: 4, icon: Film, tag: 'color & grade' },
  { prompt: 'Create a 30-second version.', changes: 12, icon: Clock, tag: 'auto cut' },
  { prompt: 'Add captions in Spanish.', changes: 28, icon: Captions, tag: 'captions · es-ES' },
  { prompt: 'Find the best moments.', changes: 5, icon: Sparkles, tag: 'moment detection' },
  { prompt: 'Create a TikTok version.', changes: 9, icon: Crop, tag: 'auto-reframe 9:16' },
];

function AIToolsSection() {
  return (
    <section
      id="ai-tools"
      className="scroll-mt-16 border-y border-border/60 bg-card/20 py-20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.div variants={itemFade} className="mb-3 flex justify-center">
            <Badge variant="secondary" className="gap-1.5 border-border/60 bg-card/60 text-primary">
              <Sparkles className="size-3.5" />
              AI Edit Engine
            </Badge>
          </motion.div>
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            AI that edits with you.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            Describe the edit in plain language. VidiaForge proposes changes on a preview layer —
            you accept, refine, or undo.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {AI_TOOLS.map((t) => (
            <motion.div key={t.prompt} variants={itemFade}>
              <Card className="h-full gap-4 border-border/60 bg-card/60 backdrop-blur-sm transition-colors hover:border-primary/40">
                <CardContent className="flex flex-col gap-4 px-5 py-5">
                  {/* Prompt — code-style block */}
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <t.icon className="size-4" />
                    </span>
                    <pre className="flex-1 overflow-x-auto rounded-md border border-border/60 bg-editor-panel px-3 py-2 font-mono text-xs text-foreground">
                      <span className="text-primary">›</span> {t.prompt}
                    </pre>
                  </div>

                  {/* Chip */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                      <Zap className="size-3" />
                      AI proposed {t.changes} changes
                    </Badge>
                    <span className="text-xs text-muted-foreground">{t.tag}</span>
                  </div>

                  {/* Mock actions */}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Button size="sm" className="gap-1.5">
                      <Check className="size-3.5" />
                      Apply
                    </Button>
                    <Button size="sm" variant="outline">
                      Review
                    </Button>
                    <Button size="sm" variant="ghost">
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          variants={itemFade}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mx-auto mt-8 flex max-w-2xl items-center justify-center gap-2 text-center text-xs text-muted-foreground"
        >
          <ShieldCheck className="size-3.5 text-primary" />
          Every AI edit is previewable, reversible, and undoable. We never destroy your work.
        </motion.p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Templates Section                                               */
/* ------------------------------------------------------------------ */

interface Template {
  name: string;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TEMPLATES: Template[] = [
  { name: 'TikTok', icon: Video, gradient: 'from-amber-500/80 via-orange-600/60 to-rose-700/70' },
  { name: 'Reels', icon: Video, gradient: 'from-fuchsia-600/70 via-rose-600/60 to-amber-500/70' },
  { name: 'YouTube', icon: Video, gradient: 'from-red-600/70 via-orange-600/60 to-amber-500/70' },
  { name: 'Shorts', icon: Smartphone, gradient: 'from-rose-600/70 via-amber-500/60 to-orange-600/70' },
  { name: 'Business', icon: Monitor, gradient: 'from-amber-600/70 via-amber-500/50 to-stone-700/60' },
  { name: 'Marketing', icon: Sparkles, gradient: 'from-orange-500/70 via-amber-500/60 to-yellow-600/60' },
  { name: 'Podcast', icon: Mic, gradient: 'from-emerald-600/60 via-teal-700/50 to-amber-700/50' },
  { name: 'Wedding', icon: Sparkles, gradient: 'from-rose-400/70 via-amber-300/50 to-orange-500/60' },
  { name: 'Birthday', icon: Sparkles, gradient: 'from-amber-400/70 via-rose-500/60 to-fuchsia-600/60' },
  { name: 'Travel', icon: Globe, gradient: 'from-amber-500/70 via-emerald-600/50 to-cyan-700/60' },
  { name: 'Fashion', icon: Sparkles, gradient: 'from-rose-500/70 via-fuchsia-600/60 to-violet-700/60' },
  { name: 'Music', icon: Volume2, gradient: 'from-violet-600/70 via-amber-500/50 to-orange-600/60' },
  { name: 'Education', icon: Type, gradient: 'from-amber-500/60 via-amber-600/50 to-stone-700/60' },
  { name: 'Real estate', icon: Monitor, gradient: 'from-amber-600/60 via-orange-600/50 to-stone-700/60' },
  { name: 'Product', icon: Film, gradient: 'from-orange-500/70 via-amber-500/60 to-amber-700/60' },
];

function TemplatesSection() {
  return (
    <section id="templates" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Start from a template, not a blank canvas.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            Pre-built structures for every platform and format — drop in your media and ship in minutes.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          {TEMPLATES.map((t) => (
            <motion.div key={t.name} variants={itemFade}>
              <button
                type="button"
                onClick={goRegister}
                aria-label={`Use ${t.name} template`}
                className="group relative block aspect-[4/5] w-full overflow-hidden rounded-xl border border-border/60 text-left transition-all hover:border-primary/50 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* Gradient thumbnail */}
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br opacity-90 transition-opacity group-hover:opacity-100',
                    t.gradient
                  )}
                />
                {/* Subtle grain overlay */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)',
                  }}
                />
                {/* Top icon */}
                <div className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-md bg-black/30 backdrop-blur-sm">
                  <t.icon className="size-4 text-white" />
                </div>
                {/* Bottom name */}
                <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                  <span className="text-sm font-semibold text-white drop-shadow-sm">{t.name}</span>
                  <span className="flex translate-y-2 items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-black opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                    Use template
                    <ArrowRight className="size-3" />
                  </span>
                </div>
              </button>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  7. Workflow / How it works                                         */
/* ------------------------------------------------------------------ */

const WORKFLOW = [
  {
    icon: HardDrive,
    title: '1. Import or record',
    desc: 'Drag in your footage, record your screen + camera, or pick a template. Everything stays local.',
  },
  {
    icon: Spline,
    title: '2. Edit on the timeline',
    desc: 'Cut, trim, layer, grade, animate, and let AI handle the busywork — all non-destructive.',
  },
  {
    icon: Download,
    title: '3. Export anywhere',
    desc: 'Export to MP4, WebM, or any social aspect ratio. Queue multiple renders at once.',
  },
];

function WorkflowSection() {
  return (
    <section
      id="workflow"
      className="scroll-mt-16 border-y border-border/60 bg-card/20 py-20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            From footage to finished in three steps.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            No installs. No plugins. No render queue on someone else's server.
          </motion.p>
        </motion.div>

        <motion.ol
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {WORKFLOW.map((step, i) => (
            <motion.li key={step.title} variants={itemFade} className="relative">
              {/* Dashed connector (desktop only) */}
              {i < WORKFLOW.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-3 top-9 hidden h-px w-6 border-t border-dashed border-border md:block"
                />
              )}
              <Card className="h-full gap-4 border-border/60 bg-card/60 backdrop-blur-sm">
                <CardContent className="flex flex-col gap-3 px-5 py-5">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="size-5" />
                  </span>
                  <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  8. Pricing Section                                                 */
/* ------------------------------------------------------------------ */

interface Plan {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    tagline: 'For trying out the editor and short-form clips.',
    icon: Sparkles,
    features: [
      'Full timeline editor',
      'Up to 720p export',
      '5 projects',
      'Basic AI edits (limited / mo)',
      'Community support',
    ],
    cta: 'Start free',
  },
  {
    name: 'Creator',
    price: '$12',
    cadence: '/ month',
    tagline: 'For creators shipping every week.',
    icon: Zap,
    features: [
      'Everything in Free',
      '4K export',
      'Unlimited projects',
      'Full AI edit suite',
      'Background removal & auto-reframe',
      'Project version history',
      'Priority support',
    ],
    cta: 'Choose Creator',
    highlight: true,
  },
  {
    name: 'Pro',
    price: '$24',
    cadence: '/ month',
    tagline: 'For studios and heavy workloads.',
    icon: InfinityIcon,
    features: [
      'Everything in Creator',
      'AV1 & ProRes-style exports',
      'Team workspace (3 seats)',
      'Shared asset library',
      'Render queue priority',
      'Early access to AI tools',
      'Dedicated support',
    ],
    cta: 'Choose Pro',
  },
];

function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Pricing that scales with you.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            Start free. Upgrade when you ship. Cancel anytime.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          {PLANS.map((p) => (
            <motion.div key={p.name} variants={itemFade} className={cn(p.highlight && 'md:-mt-3 md:mb-3')}>
              <Card
                className={cn(
                  'relative h-full gap-5 bg-card/60 backdrop-blur-sm',
                  p.highlight
                    ? 'border-primary/60 shadow-[0_0_32px_-8px_oklch(0.78_0.17_70/0.35)]'
                    : 'border-border/60'
                )}
              >
                {p.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="gap-1 bg-primary px-3 py-1 text-primary-foreground">
                      <Sparkles className="size-3" />
                      Most popular
                    </Badge>
                  </div>
                )}
                <CardContent className="flex flex-col gap-5 px-6 py-6">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <p.icon className="size-5" />
                    </span>
                    <span className="text-base font-semibold text-foreground">{p.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold tracking-tight text-foreground">{p.price}</span>
                    <span className="text-sm text-muted-foreground">{p.cadence}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{p.tagline}</p>

                  <Separator className="bg-border/60" />

                  <ul className="flex flex-col gap-2.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground/90">
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-1">
                    <Button
                      className="w-full"
                      variant={p.highlight ? 'default' : 'outline'}
                      onClick={goRegister}
                    >
                      {p.cta}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Business banner */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          <Card className="mt-4 overflow-hidden border-border/60 bg-gradient-to-r from-card/80 via-card/60 to-card/80 backdrop-blur-sm">
            <CardContent className="flex flex-col items-start justify-between gap-4 px-6 py-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FlaskConical className="size-5" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Business & Teams</h3>
                  <p className="text-sm text-muted-foreground">
                    Custom seats, SSO, audit logs, and on-prem render workers. Built for newsrooms and agencies.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={goRegister} className="gap-1.5">
                Contact sales
                <ArrowRight className="size-3.5" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        <p className="mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          Billing is architecture-ready — not yet enforced. You won’t be charged today.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  9. FAQ Section                                                     */
/* ------------------------------------------------------------------ */

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Do I need to install anything?',
    a: 'No. VidiaForge runs in your browser and is installable as a PWA. Add it to your home screen for a full-screen, native-like experience.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes. VidiaForge ships a dedicated mobile editor experience with a touch-optimized timeline, gesture-based trimming, and a collapsible inspector.',
  },
  {
    q: 'Where is my media stored?',
    a: 'Locally during editing. Media is never sent to external services without your explicit action — uploads are opt-in and encrypted in transit.',
  },
  {
    q: 'Can I export 4K?',
    a: 'Yes, on Creator and Pro plans. 4K (and higher) export is architecture-ready; the export pipeline supports H.264, H.265, VP9, and AV1.',
  },
  {
    q: 'Is my work saved if my browser crashes?',
    a: 'Yes. VidiaForge takes periodic snapshots to IndexedDB and shows a project recovery prompt on reopen. You’ll never lose more than a few seconds.',
  },
  {
    q: 'Which AI providers are supported?',
    a: 'A provider abstraction supports OpenAI, Deepgram, ElevenLabs, and local models. You can bring your own API keys or use built-in defaults.',
  },
  {
    q: 'Can I edit offline?',
    a: 'The application shell works offline — you can open, scrub, and trim existing projects. Heavy processing (AI, encode) requires a connection.',
  },
  {
    q: 'Is it really non-destructive?',
    a: 'Yes. Your original media is never modified. Edits are stored as instructions on the timeline and rendered on demand during export.',
  },
];

function FAQSection() {
  return (
    <section
      id="faq"
      className="scroll-mt-16 border-t border-border/60 bg-card/20 py-20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.h2
            variants={itemFade}
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Frequently asked questions.
          </motion.h2>
          <motion.p
            variants={itemFade}
            className="mt-3 text-balance text-muted-foreground"
          >
            Everything you want to know before you start editing.
          </motion.p>
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-10"
        >
          <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
            <CardContent className="px-6 py-2">
              <Accordion type="single" collapsible className="w-full">
                {FAQS.map((item, i) => (
                  <AccordionItem key={item.q} value={`item-${i}`}>
                    <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline sm:text-base">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  10. Final CTA Section                                              */
/* ------------------------------------------------------------------ */

function FinalCTASection() {
  return (
    <section
      aria-label="Start creating with VidiaForge"
      className="relative overflow-hidden border-t border-border/60 bg-grid py-24 sm:py-32"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 50% 50%, oklch(0.78 0.17 70 / 0.18), transparent 70%)',
        }}
      />
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 text-center sm:px-6 lg:px-8"
      >
        <motion.h2
          variants={itemFade}
          className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          Start creating today.
        </motion.h2>
        <motion.p
          variants={itemFade}
          className="text-balance text-muted-foreground"
        >
          No download. No credit card. Just open and edit.
        </motion.p>
        <motion.div variants={itemFade} className="flex flex-col items-center gap-3 sm:flex-row">
          <Button size="lg" onClick={goRegister} className="gap-2">
            Open the editor
            <ArrowRight className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Free forever · 720p export · 5 projects
          </span>
        </motion.div>
      </motion.div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  11. Footer                                                         */
/* ------------------------------------------------------------------ */

const FOOTER_COLS: { title: string; links: string[] }[] = [
  {
    title: 'Product',
    links: ['Features', 'Templates', 'Pricing', 'Changelog'],
  },
  {
    title: 'Resources',
    links: ['Documentation', 'Tutorials', 'Blog', 'Status'],
  },
  {
    title: 'Company',
    links: ['About', 'Careers', 'Contact', 'Press'],
  },
  {
    title: 'Legal',
    links: ['Privacy', 'Terms', 'Security', 'Licenses'],
  },
];

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {/* Logo column */}
          <div className="col-span-2 flex flex-col gap-3 lg:col-span-1">
            <Logo />
            <p className="max-w-xs text-xs text-muted-foreground">
              A cinematic, AI-powered video editor that runs entirely in your browser.
              Installable as a PWA.
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="flex flex-col gap-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.title}
              </h3>
              {col.links.map((link) => (
                <button
                  key={link}
                  type="button"
                  onClick={() => {
                    if (link === 'Features') scrollToId('features');
                    else if (link === 'Templates') scrollToId('templates');
                    else if (link === 'Pricing') scrollToId('pricing');
                    else if (link === 'Status') scrollToId('top');
                    else goLogin();
                  }}
                  className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link}
                </button>
              ))}
            </nav>
          ))}
        </div>

        <Separator className="my-8 bg-border/60" />

        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-xs text-muted-foreground">
              © 2025 VidiaForge. Crafted for creators.
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Status: All systems operational
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Languages className="size-3.5 text-primary" />
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-border/60 bg-card/60 px-2 py-1 transition-colors hover:text-foreground"
              aria-label="Select language"
            >
              English
              <ChevronRight className="size-3 -rotate-90" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Root Landing View                                                  */
/* ------------------------------------------------------------------ */

export function LandingView() {
  // Ensure smooth scrolling is enabled at the html level at runtime.
  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = '';
    };
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <NavBar />
      <main className="flex-1">
        <HeroSection />
        <StatsStrip />
        <FeaturesSection />
        <AIToolsSection />
        <TemplatesSection />
        <WorkflowSection />
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
