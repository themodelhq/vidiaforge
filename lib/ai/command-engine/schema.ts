// VidiaForge — AI command engine Zod schema
// Defines the command union for AI-generated edit commands.
// Used by validateAIResponse() to strip unknown fields + reject malformed input.

import { z } from 'zod';

// === Command parameter schemas ===

export const TrimClipCommand = z.object({
  type: z.literal('trim_clip'),
  clipId: z.string().min(1),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
});

export const SplitClipCommand = z.object({
  type: z.literal('split_clip'),
  clipId: z.string().min(1),
  time: z.number().min(0),
});

export const DeleteClipCommand = z.object({
  type: z.literal('delete_clip'),
  clipId: z.string().min(1),
});

export const MoveClipCommand = z.object({
  type: z.literal('move_clip'),
  clipId: z.string().min(1),
  toTimelineStart: z.number().min(0),
  toTrackId: z.string().optional(),
});

export const ChangeSpeedCommand = z.object({
  type: z.literal('change_speed'),
  clipId: z.string().optional(), // optional → applies to all selected clips
  factor: z.number().min(0.25).max(4),
});

export const ChangeVolumeCommand = z.object({
  type: z.literal('change_volume'),
  clipId: z.string().optional(),
  volume: z.number().min(0).max(2),
});

export const AddTextCommand = z.object({
  type: z.literal('add_text'),
  text: z.string().min(1).max(2000),
  position: z.enum(['center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']),
  duration: z.number().min(0.1).max(60).optional(),
  atTime: z.number().min(0).optional(),
  trackId: z.string().optional(),
});

export const RemoveTextCommand = z.object({
  type: z.literal('remove_text'),
  clipId: z.string().min(1),
});

export const AddCaptionCommand = z.object({
  type: z.literal('add_caption'),
  assetId: z.string().optional(), // source audio for transcription; defaults to first audio clip
  language: z.string().optional(),
  style: z.string().optional(),
});

export const RemoveSilenceCommand = z.object({
  type: z.literal('remove_silence'),
  threshold: z.number().min(0).max(1).optional(), // silence threshold (0..1)
  minDuration: z.number().min(0.05).max(5).optional(),
});

export const ApplyFilterCommand = z.object({
  type: z.literal('apply_filter'),
  filter: z.enum([
    'cinematic', 'warm', 'cool', 'vintage', 'film', 'bw',
    'high-contrast', 'moody', 'vibrant', 'portrait', 'golden-hour',
  ]),
  intensity: z.number().min(0).max(1).optional(),
  clipId: z.string().optional(),
});

export const AdjustColorCommand = z.object({
  type: z.literal('adjust_color'),
  clipId: z.string().optional(),
  exposure: z.number().min(-1).max(1).optional(),
  brightness: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(-1).max(1).optional(),
  highlights: z.number().min(-1).max(1).optional(),
  shadows: z.number().min(-1).max(1).optional(),
  whites: z.number().min(-1).max(1).optional(),
  blacks: z.number().min(-1).max(1).optional(),
  saturation: z.number().min(-1).max(1).optional(),
  vibrance: z.number().min(-1).max(1).optional(),
  temperature: z.number().min(-1).max(1).optional(),
  tint: z.number().min(-1).max(1).optional(),
  hue: z.number().min(-180).max(180).optional(),
});

export const AddTransitionCommand = z.object({
  type: z.literal('add_transition'),
  transitionType: z.enum([
    'cut', 'cross-dissolve', 'fade', 'dip-to-black', 'dip-to-white',
    'wipe', 'slide', 'zoom', 'blur', 'spin', 'glitch',
    'light-leak', 'film-burn', 'flash', 'whip-pan', 'morph', 'push',
  ]),
  duration: z.number().min(0.05).max(5),
  clipId: z.string().optional(),
});

export const AddMarkerCommand = z.object({
  type: z.literal('add_marker'),
  time: z.number().min(0),
  label: z.string().max(80).optional(),
  color: z.string().max(20).optional(),
});

export const DuplicateClipCommand = z.object({
  type: z.literal('duplicate_clip'),
  clipId: z.string().min(1),
});

export const CreateShortCommand = z.object({
  type: z.literal('create_short'),
  count: z.number().int().min(1).max(10),
  aspectRatio: z.enum(['9:16', '1:1', '4:5']).optional(),
  maxDuration: z.number().min(5).max(60).optional(),
});

export const ReframeCommand = z.object({
  type: z.literal('reframe'),
  aspectRatio: z.enum(['9:16', '1:1', '4:5', '16:9']),
  mode: z.enum(['center', 'smart', 'face']).optional(),
  clipId: z.string().optional(),
});

// === Union ===

export const AICommandSchema = z.discriminatedUnion('type', [
  TrimClipCommand,
  SplitClipCommand,
  DeleteClipCommand,
  MoveClipCommand,
  ChangeSpeedCommand,
  ChangeVolumeCommand,
  AddTextCommand,
  RemoveTextCommand,
  AddCaptionCommand,
  RemoveSilenceCommand,
  ApplyFilterCommand,
  AdjustColorCommand,
  AddTransitionCommand,
  AddMarkerCommand,
  DuplicateClipCommand,
  CreateShortCommand,
  ReframeCommand,
]);

export const AICommandListSchema = z.array(AICommandSchema);

export const AIResponseSchema = z.object({
  summary: z.string().min(1),
  commands: AICommandListSchema,
});

export type AICommand = z.infer<typeof AICommandSchema>;
export type AICommandList = z.infer<typeof AICommandListSchema>;
export type AIResponse = z.infer<typeof AIResponseSchema>;

export const COMMAND_TYPES = [
  'trim_clip', 'split_clip', 'delete_clip', 'move_clip',
  'change_speed', 'change_volume', 'add_text', 'remove_text',
  'add_caption', 'remove_silence', 'apply_filter', 'adjust_color',
  'add_transition', 'add_marker', 'duplicate_clip', 'create_short',
  'reframe',
] as const;
