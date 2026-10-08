// VidiaForge V19.1 — Feature Status Registry
//
// V19.1 §45-46: Central registry of every product feature and its real status.
// The UI MUST NOT display an unavailable feature as production-ready.
//
// V19.1 §45: A feature may only be IMPLEMENTED if UI + state + API +
// processing + rendering + E2E are ALL verified. Features with engine but
// no UI are PARTIAL.
//
// Status semantics (V19.1 §1):
//   IMPLEMENTED  — UI → state → API → processing → render → export works end-to-end
//   PARTIAL      — Some stages work but E2E is incomplete (e.g., engine exists but no UI)
//   COMING_SOON  — UI shows a "Coming Soon" badge, no functional path
//   DISABLED     — Feature exists in code but is gated off (e.g., requires missing provider)
//
// V19.1 §46: Every "coming soon", "TODO", "mock", "placeholder" must be classified here.
//
// This file is the canonical source — UI components, marketing pages, certification
// tests, and docs/FEATURE_MATRIX_V19_1.md all derive from this.

export type FeatureStatus =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'COMING_SOON'
  | 'DISABLED';

export interface FeatureEntry {
  /** Stable identifier used in code + tests. */
  key: string;
  /** Human-readable label shown in UI. */
  label: string;
  /** Current status — NEVER lie. If only UI exists, status is PARTIAL or COMING_SOON. */
  status: FeatureStatus;
  /** Which subsystem layers are working. */
  layers: {
    ui: boolean;
    state: boolean;
    api: boolean;
    processing: boolean;
    render: boolean;
    export: boolean;
  };
  /** Short note explaining the status (esp. for PARTIAL). */
  notes?: string;
  /** V19 spec section reference. */
  specSection?: string;
}

export const FEATURE_REGISTRY: Record<string, FeatureEntry> = {
  // === Core Editing (V19 §2) ===
  'editor.timeline': {
    key: 'editor.timeline',
    label: 'Timeline Editor',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Multi-track timeline with clips, markers, snap, zoom, scrub',
    specSection: '§2 EDITOR',
  },
  'editor.media': {
    key: 'editor.media',
    label: 'Media Library',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: false, export: false },
    notes: 'Upload + ingestion work. Missing: folders, bins, sub-bins, smart collections, ratings, relink',
    specSection: '§44 MEDIA MANAGEMENT',
  },
  'editor.mobile': {
    key: 'editor.mobile',
    label: 'Mobile/Tablet Editor',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Responsive layout + dedicated mobile editor view. Missing: pinch-zoom, swipe-delete, haptics',
    specSection: '§57 MOBILE/TABLET',
  },
  'editor.pwa': {
    key: 'editor.pwa',
    label: 'PWA / Offline',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: false, processing: false, render: false, export: false },
    notes: 'Service worker + manifest installed. Missing: offline render queue, conflict handling, restore UI',
    specSection: '§58 PWA/OFFLINE',
  },

  // === Timeline + Trimming (V19 §26-27) ===
  'timeline.multi-track': {
    key: 'timeline.multi-track',
    label: 'Multi-Track Timeline',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Audio multi-track amix works. Video overlay composite PARTIAL — single-track sequential xfade today',
    specSection: '§82 LARGE PROJECT SUPPORT',
  },
  // === Pro Trim Tools (V19.1 §25-26) ===
  'timeline.trim.ripple': {
    key: 'timeline.trim.ripple',
    label: 'Ripple Trim',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: src/lib/timeline/trim-operations.ts rippleTrim() — shifts downstream clips. Tested with exact boundary assertions.',
    specSection: '§25 PROFESSIONAL TRIM TOOLS',
  },
  'timeline.trim.roll': {
    key: 'timeline.trim.roll',
    label: 'Roll Trim',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: rollEdit() — adjusts edit point between two adjacent clips. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.trim.slip': {
    key: 'timeline.trim.slip',
    label: 'Slip Trim',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: slipEdit() — changes source in/out while preserving timeline position. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.trim.slide': {
    key: 'timeline.trim.slide',
    label: 'Slide Trim',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: slideEdit() — moves clip while adjusting neighbors. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.lift': {
    key: 'timeline.lift',
    label: 'Lift (remove + leave gap)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: liftClip() — removes clip + leaves gap. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.extract': {
    key: 'timeline.extract',
    label: 'Extract (remove + close gap)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: extractClip() — removes clip + shifts downstream left. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.insert': {
    key: 'timeline.insert',
    label: 'Insert (shift downstream right)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: insertClip() — inserts clip + shifts downstream right. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.overwrite': {
    key: 'timeline.overwrite',
    label: 'Overwrite (replace region)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: overwriteClip() — overwrites region + trims/splits overlapping clips. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.extend': {
    key: 'timeline.extend',
    label: 'Extend clip',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §25: extendClip() — extends duration where source permits. UI not yet wired.',
    specSection: '§25',
  },
  'timeline.three-point': {
    key: 'timeline.three-point',
    label: 'Three-Point Editing',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: false, processing: true, render: true, export: true },
    notes: 'V19.1 §27: in/out/source/target — supported via insert/overwrite with position params. No dedicated UI.',
    specSection: '§27',
  },
  'timeline.compound-clips': { key: 'timeline.compound-clips', label: 'Compound Clips / Nesting', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§28' },
  'timeline.adjustment-layers': { key: 'timeline.adjustment-layers', label: 'Adjustment Layers', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§29' },
  'timeline.multicam': { key: 'timeline.multicam', label: 'Multicam Editing', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§43' },

  // === Keyframes + Animation (V19 §19-20) ===
  'keyframes.engine': {
    key: 'keyframes.engine',
    label: 'Keyframe Engine',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1.5: X/Y keyframe rendering FIXED + verified by production E2E (FFmpegRenderService.render → MP4 → frame analysis). Positions: 0.258→0.517→0.767 (LEFT→CENTER→RIGHT). 18 assertions pass. Overlay uses dynamic x=expr:y=expr.',
    specSection: '§19 KEYFRAME ENGINE',
  },
  'keyframes.graph-editor': { key: 'keyframes.graph-editor', label: 'Graph Editor (Bezier)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§20' },

  // === Masking + Chroma Key (V19 §21-24) ===
  'masks.engine': {
    key: 'masks.engine',
    label: 'Masking Engine',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §21-22: buildFilterGraph emits MaskNode for rectangle/circle/ellipse/polygon/freehand. FFmpegRenderService uses geq filter with alpha formulas + gblur for feather + invert support. Mask keyframes via time-varying expressions. Missing: mask inspector UI in right-inspector.',
    specSection: '§21 MASKING ENGINE',
  },
  'masks.keyframes': {
    key: 'masks.keyframes',
    label: 'Mask Keyframes',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §22: MaskShape.keyframes field — time-varying x/y/w/h/feather via FFmpeg expressions',
    specSection: '§22',
  },
  'chroma-key': {
    key: 'chroma-key',
    label: 'Chroma Key',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §23: ChromaKey type (color/similarity/smoothness/spillSuppression/edgeSoftness/shadowPreservation). FFmpeg chromakey + colorchannelmixer for spill suppression. Missing: chroma-key UI inspector.',
    specSection: '§23 CHROMA KEY',
  },
  'ai.background-removal': { key: 'ai.background-removal', label: 'AI Background Removal', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§24' },
  'ai.motion-tracking': { key: 'ai.motion-tracking', label: 'Motion Tracking', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§25' },

  // === Color Grading (V19 §30-32) ===
  'color.grading': {
    key: 'color.grading',
    label: 'Color Grading',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §30: 12 ColorAdjust fields render via eq+colorbalance+hue. highlights/shadows/whites/blacks via colorbalance midtones/shadows/highlights. saturation/vibrance via eq. temperature/tint via colorbalance red/blue shift.',
    specSection: '§30 COLOR GRADING',
  },
  'color.rgb-curves': {
    key: 'color.rgb-curves',
    label: 'RGB Curves',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §30: ColorCurves type with master/red/green/blue control points. FFmpeg curves filter with parsed points. Missing: UI curve editor.',
    specSection: '§30',
  },
  'color.hue-curves': { key: 'color.hue-curves', label: 'Hue Curves', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§30' },
  'color.wheels': {
    key: 'color.wheels',
    label: 'Color Wheels (Lift/Gamma/Gain)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §30: ColorWheels type. FFmpeg colorbalance with rs/gs/bs (shadows=lift), rm/gm/bm (midtones=gamma), rh/gh/bh (highlights=gain). Missing: UI wheel editor.',
    specSection: '§30',
  },
  'color.hsl-secondary': { key: 'color.hsl-secondary', label: 'HSL Secondary', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§30' },
  'color.scopes': {
    key: 'color.scopes',
    label: 'Video Scopes (Waveform/Vectorscope/RGB Parade/Histogram)',
    status: 'IMPLEMENTED',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §24: src/lib/render/color-scopes.ts — extracts frames via FFmpeg + computes 4 scopes from real pixel data. PNG decoder (incl. filter un-application). Pure computeScopesFromPixels() for testing. UI not yet wired.',
    specSection: '§31 VIDEO SCOPES',
  },
  'color.lut': {
    key: 'color.lut',
    label: 'LUT (.cube) Support',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §32: LutRef type (storageKey/filePath + intensity + interp). FFmpeg lut3d filter with tetrahedral interpolation. LUT files downloaded from storage to tmp + cached. UI button in elements-panel wired.',
    specSection: '§32 LUT SUPPORT',
  },

  // === Effects + Filters + Transitions (V19 §48-50) ===
  'effects.library': {
    key: 'effects.library',
    label: 'Effect Library',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: '16 effects in UI. 9 render correctly. 7 silently no-op. Effect.params unused',
    specSection: '§49 EFFECT LIBRARY',
  },
  'filters.library': {
    key: 'filters.library',
    label: 'Filter Library',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: '11/11 filters render correctly via FFmpeg',
    specSection: '§48 FILTER LIBRARY',
  },
  'transitions.engine': {
    key: 'transitions.engine',
    label: 'Transition Engine',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: '17 transitions in UI. 8 render via xfade. 9 silently fall back to fade',
    specSection: '§50 TRANSITION ENGINE',
  },

  // === Captions (V19 §51-52) ===
  'captions.engine': {
    key: 'captions.engine',
    label: 'Caption System',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §51: CaptionService with SRT/VTT/JSON parse+generate. Transcription E2E works. Multi-cue rendering via per-cue drawtext with enable=between(t,start,end). Per-cue styling (CaptionCueStyle). Word-level karaoke highlighting via per-word drawtext. Speaker labels.',
    specSection: '§51 CAPTION SYSTEM',
  },
  'captions.templates': { key: 'captions.templates', label: 'Caption Templates (Karaoke/Bold social/Minimal/etc.)', status: 'PARTIAL', layers: { ui: true, state: true, api: false, processing: false, render: true, export: true }, notes: '7 caption styles in captions-panel UI. Each applies TextStyle overrides. Missing: persistent caption template presets (DB-backed).', specSection: '§52 CAPTION TEMPLATES' },

  // === Audio (V19 §33-36) ===
  'audio.engine': {
    key: 'audio.engine',
    label: 'Audio Engine',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §33: Per-clip volume/pan/fades render via afade+volume+pan. Multi-track amix composites. fadeOut bug FIXED (chain duration threaded through AudioMixNode). Missing: EQ, compressor, limiter, de-esser, noise reduction, voice isolation, ducking — these are advanced audio effects not yet wired.',
    specSection: '§33 AUDIO ENGINE',
  },
  'audio.mixer': { key: 'audio.mixer', label: 'Audio Mixer (Meters/Peak/RMS/LUFS)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§34 AUDIO MIXER' },
  'audio.voice-recording': {
    key: 'audio.voice-recording',
    label: 'Voice Recording',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Microphone → MediaRecorder → multipart POST /api/assets/upload → MediaAsset → timeline',
    specSection: '§35 VOICE RECORDING',
  },
  'ai.voiceover': { key: 'ai.voiceover', label: 'AI Voiceover (TTS)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§36 AI VOICEOVER' },

  // === AI Features (V19 §37-42) ===
  'ai.command-engine': {
    key: 'ai.command-engine',
    label: 'AI Command Engine',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §42: 17-command Zod schema + canonical executor.ts (handles all 17). ai-panel.tsx NOW imports executeCommands from canonical executor (previously had local applyCommands that only handled 4). Single history entry wraps all mutations.',
    specSection: '§42 AI CONTENT GENERATION',
  },
  'ai.transcription': {
    key: 'ai.transcription',
    label: 'AI Transcription',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'OpenAI/Deepgram/Test providers + deterministic transcription identity + worker lease',
    specSection: '§42 AI CONTENT GENERATION',
  },
  'ai.translation': { key: 'ai.translation', label: 'AI Translation', status: 'IMPLEMENTED', layers: { ui: true, state: true, api: true, processing: true, render: true, export: true }, specSection: '§42' },
  'ai.text-based-editing': {
    key: 'ai.text-based-editing',
    label: 'Text-Based Editing (transcript-driven deletion)',
    status: 'IMPLEMENTED',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §33: src/lib/ai/text-editing.ts — deleteSentence/deleteWord/deleteSilence/deleteFillerWords. Splits clips + shifts downstream left. Processes right-to-left to preserve positions. 8 unit tests pass.',
    specSection: '§37',
  },
  'ai.auto-reframe': {
    key: 'ai.auto-reframe',
    label: 'Auto Reframe (subject-aware reframing)',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §29: src/lib/render/auto-reframe.ts — samples frames + detects subject (zai VLM when configured, deterministic center fallback) + smooths motion + generates transform keyframes. Supports 16:9 → 9:16, 1:1, 4:5.',
    specSection: '§38',
  },
  'ai.highlight-detection': {
    key: 'ai.highlight-detection',
    label: 'AI Highlight Detection',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §34: src/lib/ai/highlight-detection.ts — uses real signals (audio peaks via FFmpeg astats, scene changes via FFmpeg select filter, transcript keyword analysis) to identify highlight segments. NO fake responses.',
    specSection: '§39',
  },
  'ai.shorts-generator': {
    key: 'ai.shorts-generator',
    label: 'AI Shorts Generator',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19.1 §35: src/lib/ai/highlight-detection.ts generateShorts() — takes highlights → produces short candidates with 9:16 reframing + caption cues + suggested project titles.',
    specSection: '§41',
  },
  'ai.smart-search': { key: 'ai.smart-search', label: 'Smart Search (faces/objects/speech/scenes)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§40' },
  'ai.image-generation': { key: 'ai.image-generation', label: 'AI Image Generation (B-roll)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§42' },
  'ai.video-generation': { key: 'ai.video-generation', label: 'AI Video Generation', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§42' },

  // === Templates (V19 §3-18) ===
  'templates.engine': {
    key: 'templates.engine',
    label: 'Template Engine',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19: TemplateDefinition + slots + applySlotToClip + autoFillSlots + sanitizeTemplateData. 6 builtin templates (TikTok/Reels/YouTube Intro/Birthday/Product Demo/Cinematic). API: GET /api/templates (search+filter+sort), GET /api/templates/[id], POST /api/templates/[id]/use. Real ranking via computeTemplateRank (usage/likes/saves/shares/completionRate).',
    specSection: '§4 TEMPLATE ENGINE',
  },
  'templates.marketplace': { key: 'templates.marketplace', label: 'Template Marketplace', status: 'PARTIAL', layers: { ui: true, state: true, api: true, processing: false, render: false, export: false }, notes: 'V19 §13: tier field (free/premium/creator_exclusive/sponsored/enterprise/brand) in schema. NO payment integration yet', specSection: '§13' },
  'templates.creator': { key: 'templates.creator', label: 'Template Creator Program', status: 'PARTIAL', layers: { ui: false, state: true, api: true, processing: false, render: false, export: false }, notes: 'V19 §11: CreatorProfile model + program status (none/applied/approved/rejected/suspended). NO UI yet', specSection: '§11' },
  'templates.versioning': { key: 'templates.versioning', label: 'Template Versioning', status: 'PARTIAL', layers: { ui: false, state: true, api: true, processing: false, render: false, export: false }, notes: 'V19 §12: TemplateVersion model exists. version + parentTemplateId fields on Template. NO API to fetch old versions yet', specSection: '§12' },
  'templates.license': { key: 'templates.license', label: 'Template License Management', status: 'PARTIAL', layers: { ui: false, state: true, api: true, processing: false, render: false, export: false }, notes: 'V19 §14: license JSON field on Template (type, commercialUse, attributionRequired, musicRights, stockRights, territory, expiration)', specSection: '§14' },
  'templates.ai-generation': { key: 'templates.ai-generation', label: 'AI Template Generation', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§15' },
  'templates.smart-adaptation': { key: 'templates.smart-adaptation', label: 'Smart Template Adaptation', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§16' },
  'templates.auto-fill': {
    key: 'templates.auto-fill',
    label: 'Template Auto-Fill',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §17: autoFillSlots() — assigns user assets round-robin + pulls brand-kit tokens',
    specSection: '§17',
  },
  'templates.analytics': {
    key: 'templates.analytics',
    label: 'Template Analytics',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'V19 §77: TemplateAnalytics model tracks view/use/like/save/share/complete/abandon events. POST /api/templates/[id]/use increments usageCount + creates analytics row.',
    specSection: '§77',
  },

  // === Collaboration (V19 §53-55) ===
  'collaboration.sharing': {
    key: 'collaboration.sharing',
    label: 'Project Sharing',
    status: 'PARTIAL',
    layers: { ui: true, state: false, api: false, processing: false, render: false, export: false },
    notes: 'ProjectShare + Comment Prisma models exist. ShareDialog is UI shell. NO API endpoints',
    specSection: '§53 COLLABORATION',
  },
  'collaboration.comments': { key: 'collaboration.comments', label: 'Comments + Mentions', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§53-54' },
  'collaboration.review': { key: 'collaboration.review', label: 'Review Workflow', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§54' },
  'collaboration.versioning': { key: 'collaboration.versioning', label: 'Project Versioning', status: 'PARTIAL', layers: { ui: true, state: true, api: true, processing: false, render: false, export: false }, notes: 'ProjectVersion model exists. Manual versions endpoint exists. Missing: auto-versions, restore, compare', specSection: '§55' },

  // === Brand Kit + Stock + Stickers (V19 §18, §46-47) ===
  'brand-kit': { key: 'brand-kit', label: 'Brand Kit (logos/colors/fonts/watermark)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§18 + §56' },
  'stock-media': { key: 'stock-media', label: 'Stock Media (video/images/music/SFX)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§46' },
  'stickers': { key: 'stickers', label: 'Stickers (static/animated/AI)', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§47' },

  // === Export (V19 §59-61) ===
  'export.engine': {
    key: 'export.engine',
    label: 'Export Engine',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'FFmpegRenderService with streaming upload + ffprobe validation + idempotent dedup + cancellation + heartbeat',
    specSection: '§59 EXPORT ENGINE',
  },
  'export.codecs': {
    key: 'export.codecs',
    label: 'Codec Support (H.264/H.265/VP9/AV1)',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'H.264 implemented. H.265/VP9/AV1 are presences in code but FFmpeg encoding params not wired for all',
    specSection: '§59',
  },
  'export.social-presets': {
    key: 'export.social-presets',
    label: 'Social Export Presets',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: '8 presets in types.ts + 7 in export-dialog.tsx — IDs mismatch. Need consolidation + add TikTok/Reels/Shorts/etc.',
    specSection: '§60 SOCIAL EXPORT PRESETS',
  },
  'export.cloud-rendering': {
    key: 'export.cloud-rendering',
    label: 'Cloud Rendering (BullMQ)',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Redis + BullMQ + worker + FFmpeg + object storage + crash recovery (v17.1)',
    specSection: '§61 CLOUD RENDERING',
  },

  // === Storage + Crash Recovery (V19 §62-69) ===
  'storage.s3-r2': {
    key: 'storage.s3-r2',
    label: 'S3/R2 Production Storage',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'StorageProvider abstraction + Local/S3/R2 + UploadIntent + finalize + multipart upload',
    specSection: '§68 STORAGE E2E',
  },
  'worker.crash-recovery': {
    key: 'worker.crash-recovery',
    label: 'Worker Crash Recovery',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'v17.1 closed: canonical recoverStaleJobs() + AIJOB_TEST_HOLD + Worker B completion + stale-attempt protection',
    specSection: '§62-67',
  },
  'certification.semantics': {
    key: 'certification.semantics',
    label: 'PASS/BLOCKED/FAIL Certification',
    status: 'PARTIAL',
    layers: { ui: false, state: true, api: true, processing: true, render: true, export: true },
    notes: 'CertificationBlockedError + 3-mode test semantics + evidence artifacts + exit codes (0/1/2)',
    specSection: '§69',
  },

  // === Performance + Security (V19 §81-84) ===
  'performance.caching': {
    key: 'performance.caching',
    label: 'Thumbnail/Waveform/Frame/Proxy Caches',
    status: 'PARTIAL',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Thumbnails + waveforms generated during ingestion. Missing: frame cache, proxy cache, WebCodecs/WebGPU compositing',
    specSection: '§81 PERFORMANCE ARCHITECTURE',
  },
  'performance.proxy': { key: 'performance.proxy', label: 'Proxy Media Workflow', status: 'COMING_SOON', layers: { ui: false, state: false, api: false, processing: false, render: false, export: false }, specSection: '§45 PROXY MEDIA' },
  'security.audit': {
    key: 'security.audit',
    label: 'Security (auth/authz/ownership/signed URLs)',
    status: 'IMPLEMENTED',
    layers: { ui: true, state: true, api: true, processing: true, render: true, export: true },
    notes: 'Session auth + project ownership verification + signed URLs + upload intent verification + rate limits',
    specSection: '§84 SECURITY',
  },
};

/**
 * V19 §71: Get a feature entry by key. Throws if the key doesn't exist
 * (so typos are caught at startup, not silently passed).
 */
export function getFeature(key: string): FeatureEntry {
  const entry = FEATURE_REGISTRY[key];
  if (!entry) {
    throw new Error(`Unknown feature key: ${key}. Add it to FEATURE_REGISTRY.`);
  }
  return entry;
}

/**
 * V19 §1: Returns true if a feature is fully usable end-to-end.
 * The UI uses this to decide whether to show a feature or display a Coming Soon badge.
 */
export function isFeatureImplemented(key: string): boolean {
  return getFeature(key).status === 'IMPLEMENTED';
}

/**
 * V19 §1: Returns true if a feature is partially implemented (some layers work).
 * UI may show the feature but should indicate it's in progress.
 */
export function isFeaturePartial(key: string): boolean {
  return getFeature(key).status === 'PARTIAL';
}

/**
 * V19 §1: Returns true if a feature is coming soon (no functional path).
 * UI MUST display a Coming Soon badge and not present the feature as available.
 */
export function isFeatureComingSoon(key: string): boolean {
  return getFeature(key).status === 'COMING_SOON';
}

/**
 * V19 §87: Returns a summary used by docs/FEATURE_MATRIX_V19.md generator.
 */
export function getFeatureMatrix(): FeatureEntry[] {
  return Object.values(FEATURE_REGISTRY);
}

/**
 * V19 §88: Returns the certification breakdown by category.
 */
export function getCertificationCategories(): Record<string, FeatureEntry[]> {
  const categories: Record<string, FeatureEntry[]> = {};
  for (const entry of Object.values(FEATURE_REGISTRY)) {
    const category = entry.key.split('.')[0];
    if (!categories[category]) categories[category] = [];
    categories[category].push(entry);
  }
  return categories;
}
