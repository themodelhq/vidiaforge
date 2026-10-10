// VidiaForge — Render engine types
// RenderJobState lifecycle + FFmpegRenderInput + RenderProgress.

export enum RenderJobState {
  QUEUED = 'queued',
  PREPARING = 'preparing',
  PROCESSING = 'processing',
  ENCODING = 'encoding',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export type RenderStage =
  | 'preparing'
  | 'filter_graph'
  | 'encoding'
  | 'uploading'
  | 'finalizing'
  | 'complete';

export interface RenderProgress {
  stage: RenderStage;
  /** 0..1 overall progress. */
  progress: number;
  /** Current frame being encoded (best-effort, parsed from ffmpeg stderr). */
  currentFrame?: number;
  /** Total frames expected (computed from duration × fps). */
  totalFrames?: number;
  /** Current encoding FPS (parsed from ffmpeg stderr `fps=` field). */
  fps?: number;
  /** Wall-clock elapsed seconds. */
  elapsedSeconds?: number;
  /** Wall-clock ETA in seconds. */
  etaSeconds?: number;
}

export interface RenderOptions {
  /** Output container. */
  format: 'mp4' | 'webm' | 'mov';
  /** Output codec. */
  codec: 'h264' | 'h265' | 'vp9' | 'av1';
  /** Target resolution height. */
  height: number;
  /** Target frame rate. */
  fps: number;
  /** Target video bitrate (bps). */
  videoBitrate: number;
  /** Target audio bitrate (bps). */
  audioBitrate: number;
  /** Pixel format. */
  pixelFormat?: 'yuv420p' | 'yuv444p' | 'yuv422p';
  /** Audio sample rate. */
  audioSampleRate?: number;
  /** Audio channels. */
  audioChannels?: number;
  /** Aspect ratio numerator/denominator (for non-square pixels). */
  aspectRatio?: { w: number; h: number };
  /** Optional preset name (YouTube1080p, TikTok9x16, ...). */
  preset?: string;
}

export interface FFmpegRenderInput {
  /** Decoded project document with tracks/clips/assets. */
  project: import('../types').ProjectDocument;
  /** Asset storage refs keyed by assetId. */
  assets: Record<string, { storageKey: string; localPath?: string }>;
  /** Final output storage key (e.g. "renders/{jobId}.mp4"). */
  outputPath: string;
  /** Render options derived from the chosen preset. */
  options: RenderOptions;
  /** Optional progress callback (called with real frame/total frames). */
  onProgress?: (progress: RenderProgress) => void;
  /** Optional cancellation signal — abort to stop the ffmpeg child process. */
  signal?: AbortSignal;
}

export interface RenderResult {
  outputKey: string;
  durationSeconds: number;
}

export interface RenderPreset {
  id: string;
  label: string;
  description: string;
  options: RenderOptions;
}

export const RENDER_PRESETS: RenderPreset[] = [
  {
    id: 'youtube-1080p',
    label: 'YouTube 1080p',
    description: '16:9 1080p H.264, 8 Mbps video, AAC 192k — best for YouTube uploads.',
    options: {
      format: 'mp4', codec: 'h264', height: 1080, fps: 30,
      videoBitrate: 8_000_000, audioBitrate: 192_000,
      pixelFormat: 'yuv420p', audioSampleRate: 48_000, audioChannels: 2,
      aspectRatio: { w: 16, h: 9 }, preset: 'youtube-1080p',
    },
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K',
    description: '16:9 2160p H.264, 35 Mbps video, AAC 192k — best for 4K YouTube.',
    options: {
      format: 'mp4', codec: 'h264', height: 2160, fps: 30,
      videoBitrate: 35_000_000, audioBitrate: 192_000,
      pixelFormat: 'yuv420p', audioSampleRate: 48_000, audioChannels: 2,
      aspectRatio: { w: 16, h: 9 }, preset: 'youtube-4k',
    },
  },
  {
    id: 'tiktok-9x16',
    label: 'TikTok 9:16',
    description: '1080x1920 vertical, H.264, 5 Mbps video, AAC 128k — best for TikTok/Reels.',
    options: {
      format: 'mp4', codec: 'h264', height: 1920, fps: 30,
      videoBitrate: 5_000_000, audioBitrate: 128_000,
      pixelFormat: 'yuv420p', audioSampleRate: 44_100, audioChannels: 2,
      aspectRatio: { w: 9, h: 16 }, preset: 'tiktok-9x16',
    },
  },
  {
    id: 'instagram-reels',
    label: 'Instagram Reels',
    description: '1080x1920 vertical, H.264, 4 Mbps video, AAC 128k — best for IG Reels.',
    options: {
      format: 'mp4', codec: 'h264', height: 1920, fps: 30,
      videoBitrate: 4_000_000, audioBitrate: 128_000,
      pixelFormat: 'yuv420p', audioSampleRate: 44_100, audioChannels: 2,
      aspectRatio: { w: 9, h: 16 }, preset: 'instagram-reels',
    },
  },
  {
    id: 'instagram-feed',
    label: 'Instagram Feed',
    description: '1080x1080 square, H.264, 3.5 Mbps video, AAC 128k — best for IG Feed posts.',
    options: {
      format: 'mp4', codec: 'h264', height: 1080, fps: 30,
      videoBitrate: 3_500_000, audioBitrate: 128_000,
      pixelFormat: 'yuv420p', audioSampleRate: 44_100, audioChannels: 2,
      aspectRatio: { w: 1, h: 1 }, preset: 'instagram-feed',
    },
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    description: '1080x1920 vertical, H.264, 6 Mbps video, AAC 128k — best for YT Shorts.',
    options: {
      format: 'mp4', codec: 'h264', height: 1920, fps: 30,
      videoBitrate: 6_000_000, audioBitrate: 128_000,
      pixelFormat: 'yuv420p', audioSampleRate: 48_000, audioChannels: 2,
      aspectRatio: { w: 9, h: 16 }, preset: 'youtube-shorts',
    },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    description: '16:9 1080p H.264, 6 Mbps video, AAC 128k — best for LinkedIn video posts.',
    options: {
      format: 'mp4', codec: 'h264', height: 1080, fps: 30,
      videoBitrate: 6_000_000, audioBitrate: 128_000,
      pixelFormat: 'yuv420p', audioSampleRate: 48_000, audioChannels: 2,
      aspectRatio: { w: 16, h: 9 }, preset: 'linkedin',
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'User-defined resolution, fps, codec, and bitrate.',
    options: {
      format: 'mp4', codec: 'h264', height: 1080, fps: 30,
      videoBitrate: 8_000_000, audioBitrate: 192_000,
      pixelFormat: 'yuv420p', audioSampleRate: 48_000, audioChannels: 2,
      preset: 'custom',
    },
  },
];

export function getPreset(id: string): RenderPreset | undefined {
  return RENDER_PRESETS.find((p) => p.id === id);
}
