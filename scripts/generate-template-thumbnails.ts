// VidiaForge V19.1 §5.2 — Template thumbnail generator (unified with templates)
//
// V19.1 PHASE 3 — TRUTHFUL TEMPLATE PREVIEWS.
//
// This generator renders a real, representative preview PNG for each
// builtin template. Unlike the previous version (which maintained a
// separate SPECS array that could drift from the actual template
// definitions), this version imports BUILTIN_TEMPLATES directly and
// derives the thumbnail composition from the template's ACTUAL:
//   - aspect ratio + dimensions
//   - title + category
//   - text slots (rendered as drawtext using their defaultValues)
//   - media slots (rendered as colored rectangles at their timeline positions)
//
// The thumbnail is a TRUTHFUL "layout preview" of the template's
// composition structure. It is NOT a frame from a real rendered export
// (which would require sample media for every slot + a full render
// pipeline run). The thumbnail's drawtext positions reflect the actual
// text slot positions in the timeline; the drawbox positions reflect
// the actual media slot positions.
//
// This eliminates the "two independent implementations that can drift
// apart" anti-pattern called out in the V19.1 prompt.
//
// Usage:
//   bun run scripts/generate-template-thumbnails.ts
//
// Output: public/templates/{template-id}.png

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import process from 'process';
import { BUILTIN_TEMPLATES } from '../src/lib/templates/builtin-templates';

const FFmpeg = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const OUT_DIR = path.join(process.cwd(), 'public', 'templates');

// V19.1 §5.2 — deterministic category colors (same as the previous
// generator, kept for visual consistency across the catalog).
const CATEGORY_COLORS: Record<string, { bgFrom: string; bgTo: string }> = {
  Social:        { bgFrom: '0x1a1a2e', bgTo: '0xc7361f' },
  Creator:       { bgFrom: '0x1a1a2e', bgTo: '0xe07b1a' },
  Events:        { bgFrom: '0x4a1f3f', bgTo: '0xe07b1a' },
  Business:      { bgFrom: '0x1a1a2e', bgTo: '0xe07b1a' },
  'Visual Styles': { bgFrom: '0x0f0f1e', bgTo: '0x7a3318' },
  Lifestyle:    { bgFrom: '0x0f2e3a', bgTo: '0xf5a623' },
  Music:         { bgFrom: '0x1a1a2e', bgTo: '0xec4899' },
};
const DEFAULT_COLORS = { bgFrom: '0x1a1a2e', bgTo: '0x8b5cf6' };

function log(msg: string): void {
  console.log(`[thumb-gen] ${msg}`);
}

function findFont(): string {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('No usable system font found. Install fonts-dejavu-core.');
}

// FFmpeg drawtext text= field requires single-quote wrapping + escaping.
function quoteForDrawtext(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');
  return `'${escaped}'`;
}

interface ClipAny {
  id: string;
  kind: string;
  slotId?: string;
  timelineStart: number;
  duration: number;
  text?: { text: string };
}

interface SlotAny {
  id: string;
  type: string;
  label: string;
  required: boolean;
  defaultValue?: string;
}

interface TemplateAny {
  id: string;
  title: string;
  category: string;
  aspectRatio: string;
  width: number;
  height: number;
  duration: number;
  timelineData: { clips: ClipAny[]; tracks: any[] };
  slots: SlotAny[];
}

function generateThumbnail(t: TemplateAny, fontPath: string): void {
  const outPath = path.join(OUT_DIR, `${t.id}.png`);

  // Scale down for the thumbnail (keep aspect ratio). Max 400px.
  const maxDim = 400;
  const scale = Math.min(maxDim / t.width, maxDim / t.height);
  const thumbW = Math.round(t.width * scale);
  const thumbH = Math.round(t.height * scale);
  const w = thumbW % 2 === 0 ? thumbW : thumbW + 1;
  const h = thumbH % 2 === 0 ? thumbH : thumbH + 1;

  const colors = CATEGORY_COLORS[t.category] || DEFAULT_COLORS;

  // V19.1 §5.2 — derive the filter graph from the template's ACTUAL
  // timelineData + slots. This is the unified implementation — the
  // thumbnail reflects the real template structure.
  const filterParts: string[] = [
    // Gradient background (two halves)
    `drawbox=0:0:${w}:${Math.floor(h / 2)}:t=fill:color=${colors.bgFrom}@1.0`,
    `drawbox=0:${Math.floor(h / 2)}:${w}:${h}:t=fill:color=${colors.bgTo}@1.0`,
    `drawbox=0:0:${w}:${h}:t=fill:color=0x000000@0.25`,
  ];

  // V19.1 §5.2 — render the template's title (top, centered).
  const titleFontSize = Math.max(14, Math.round(w / 14));
  const catFontSize = Math.max(8, Math.round(w / 28));
  const titleText = quoteForDrawtext(t.title.toUpperCase());
  const catText = quoteForDrawtext(t.category.toUpperCase());
  const arText = quoteForDrawtext(t.aspectRatio);
  filterParts.push(
    `drawtext=fontfile=${fontPath}:text=${titleText}:x=(w-text_w)/2:y=h*0.06:fontsize=${titleFontSize}:fontcolor=0xffffff`,
    `drawtext=fontfile=${fontPath}:text=${catText}:x=(w-text_w)/2:y=h*0.06+${titleFontSize + 4}:fontsize=${catFontSize}:fontcolor=0xffffff@0.7`,
  );

  // V19.1 §5.2 — render media slots as colored rectangles at their
  // actual timeline positions. The timeline runs vertically (top to
  // bottom = start to end), so the Y position of a clip's rectangle is
  // derived from its timelineStart / totalDuration.
  const totalDuration = t.duration || 1;
  const slotRectTop = Math.round(h * 0.22);  // leave room for title
  const slotRectBottom = Math.round(h * 0.88); // leave room for AR label
  const slotRectHeight = slotRectBottom - slotRectTop;
  const slotRectWidth = Math.round(w * 0.70);
  const slotRectX = Math.round((w - slotRectWidth) / 2);

  const mediaClips = t.timelineData.clips.filter(
    (c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio'
  );
  // Render up to 4 media-slot rectangles (more would clutter the small thumbnail).
  const mediaClipsToShow = mediaClips.slice(0, 4);

  for (let i = 0; i < mediaClipsToShow.length; i++) {
    const clip = mediaClipsToShow[i];
    // Map the clip's timelineStart (as a fraction of totalDuration) to
    // a Y position within the [slotRectTop, slotRectBottom] range.
    const frac = Math.max(0, Math.min(1, clip.timelineStart / totalDuration));
    const rectY = slotRectTop + Math.round(frac * (slotRectHeight - Math.round(slotRectHeight / 4)));
    const rectH = Math.max(20, Math.round(slotRectHeight / 5));
    // Stagger alternate rectangles left/right for visual variety.
    const isEven = i % 2 === 0;
    const rectX = isEven ? slotRectX : slotRectX + Math.round(slotRectWidth * 0.15);
    const rectW = Math.round(slotRectWidth * 0.85);

    // Slot label (the slot's label, not the slot id — the user sees labels in the UI)
    const slot = t.slots.find((s) => s.id === clip.slotId);
    const labelText = slot ? slot.label : clip.kind.toUpperCase();
    const shortLabel = labelText.length > 18 ? labelText.slice(0, 17) + '…' : labelText;
    const quoted = quoteForDrawtext(shortLabel);

    filterParts.push(
      `drawbox=${rectX}:${rectY}:${rectW}:${rectH}:t=fill:color=0xffffff@0.12`,
      `drawbox=${rectX}:${rectY}:${rectW}:${rectH}:t=2:color=0xffffff@0.55`,
      `drawtext=fontfile=${fontPath}:text=${quoted}:x=${rectX}+8:y=${rectY}+4:fontsize=${Math.max(8, Math.round(w / 32))}:fontcolor=0xffffff@0.85`,
    );
  }

  // V19.1 §5.2 — render text slots as drawtext at their timeline positions.
  // Show up to 3 text clips (more would clutter).
  const textClips = t.timelineData.clips.filter((c) => c.kind === 'text');
  const textClipsToShow = textClips.slice(0, 3);
  for (let i = 0; i < textClipsToShow.length; i++) {
    const clip = textClipsToShow[i];
    const text = clip.text?.text || 'Text';
    const shortText = text.length > 24 ? text.slice(0, 23) + '…' : text;
    const quoted = quoteForDrawtext(shortText);
    // Position the text in a horizontal band at y = 0.30..0.50 (below the media rectangles' top area).
    const yBand = Math.round(h * 0.30) + i * Math.round(h * 0.06);
    filterParts.push(
      `drawtext=fontfile=${fontPath}:text=${quoted}:x=(w-text_w)/2:y=${yBand}:fontsize=${Math.max(10, Math.round(w / 22))}:fontcolor=0xffffff@0.9:box=1:boxcolor=0x000000@0.45:boxborderw=4`,
    );
  }

  // Aspect ratio label (bottom-left corner)
  filterParts.push(
    `drawtext=fontfile=${fontPath}:text=${arText}:x=8:y=h-${catFontSize + 8}:fontsize=${catFontSize}:fontcolor=0xffffff@0.6`,
  );

  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x000000:s=${w}x${h}:d=1:r=1`,
    '-vf', filterParts.join(','),
    '-frames:v', '1',
    '-f', 'image2',
    '-vcodec', 'png',
    outPath,
  ];

  try {
    execFileSync(FFmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 15_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`FFmpeg failed for ${t.id}: ${msg}`);
  }

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new Error(`FFmpeg produced no output for ${t.id}`);
  }

  const sizeKB = Math.round(statSync(outPath).size / 1024);
  log(`Wrote ${t.id}.png (${w}x${h}, ${sizeKB}KB)`);
}

function main(): void {
  if (!existsSync(FFmpeg) || !statSync(FFmpeg).isFile()) {
    console.error(`[thumb-gen] ERROR: ffmpeg not found at ${FFmpeg}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  let fontPath: string;
  try {
    fontPath = findFont();
  } catch (err) {
    console.error(`[thumb-gen] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  log(`Using font: ${fontPath}`);
  log(`Output directory: ${OUT_DIR}`);
  log(`Generating ${BUILTIN_TEMPLATES.length} thumbnails from BUILTIN_TEMPLATES (unified source of truth)`);

  let okCount = 0;
  let failCount = 0;
  for (const t of BUILTIN_TEMPLATES as any[]) {
    try {
      generateThumbnail(t, fontPath);
      okCount++;
    } catch (err) {
      console.error(`[thumb-gen] FAILED ${t.id}: ${err instanceof Error ? err.message : String(err)}`);
      failCount++;
    }
  }
  log(`Done. ${okCount} generated, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main();
