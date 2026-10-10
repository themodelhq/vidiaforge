// VidiaForge V19.1 §4.2 — Built-in SFX provider
//
// V19.1 v5 — HONEST SFX LABELING.
//
// Returns the synthetic SFX assets shipped under /public/audio/. These are
// generated with FFmpeg from public-domain noise sources (white/pink/brown
// noise + pure tones) and licensed CC0. They are genuinely usable as
// production sound effects for UI cues, transitions, and synthetic ambience
// beds — but they are NOT field recordings.
//
// To distinguish synthetic effects from real recordings:
//   - The 3 entries whose previous titles implied field recordings
//     ("Crowd Cheer", "Rain Ambience", "Camera Shutter") have been renamed
//     to clearly indicate their synthetic origin ("Synthetic Crowd Bed",
//     "Synthetic Rain Bed", "Synthetic Shutter").
//   - The other 5 entries ("Whoosh", "Impact Boom", "Click", "Pop",
//     "Notification") keep their generic titles because a synthetic whoosh /
//     click / pop / notification / impact is still a legitimate whoosh /
//     click / pop / notification — the title does not imply a field recording.
//   - Every entry's `description` (internal, shown in the source) clearly
//     states the noise type ("white noise burst", "1 kHz short tone", etc.)
//     so a developer inspecting the catalog understands these are synthetic.
//   - The `artist` field is "VidiaForge Library" (not a fabricated artist
//     name) and the `licenseType` is "CC0" with `attributionRequired: false`.
//
// The provider reads the ACTUAL file metadata via FFprobe at startup
// so the durations reported to the frontend are never fabricated.
//
// NOTE: This provider ONLY returns SFX. It does NOT return music —
// the music catalog requires a licensed external provider (see
// external-provider.ts). When no external provider is configured,
// `listMusic()` returns an empty list and the UI shows an honest
// empty state.

import { existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import type { AudioCatalogProvider, AudioMetadata } from './types';

// V19.1 §4.2: real SFX asset definitions. The `file` field points to a
// real WAV shipped under /public/audio/. The `description` field documents
// the synthetic noise source so developers understand these are NOT field
// recordings (it is not exposed to end users via AudioMetadata — the
// frontend shows `title` + `category` + `mood`).
interface BuiltinSfx {
  id: string;
  title: string;
  category: string;
  mood: string;
  file: string;
  description: string;
}

const BUILTIN_SFX: readonly BuiltinSfx[] = [
  { id: 'sfx-whoosh',       title: 'Whoosh',              category: 'Whoosh',  mood: 'Movement',    file: 'sfx-1-whoosh.wav',        description: 'Synthetic white-noise burst with fast attack/decay' },
  { id: 'sfx-impact',       title: 'Impact Boom',         category: 'Impact',  mood: 'Dramatic',    file: 'sfx-2-impact.wav',       description: 'Synthetic brown-noise rumble with low-frequency emphasis' },
  { id: 'sfx-click',        title: 'Click',               category: 'Click',   mood: 'UI',          file: 'sfx-3-click.wav',         description: 'Synthetic 1 kHz short tone (UI click)' },
  { id: 'sfx-pop',          title: 'Pop',                  category: 'Pop',     mood: 'UI',          file: 'sfx-4-pop.wav',           description: 'Synthetic 1.2 kHz short tone (UI pop)' },
  // V19.1 v5: the 3 entries below were previously titled "Camera Shutter",
  // "Crowd Cheer", and "Rain Ambience" — those titles implied field
  // recordings. Renamed to clearly indicate synthetic origin.
  { id: 'sfx-shutter',      title: 'Synthetic Shutter',   category: 'Camera',  mood: 'Synthetic Mechanical', file: 'sfx-5-shutter.wav', description: 'Synthetic pink-noise burst (NOT a real camera shutter)' },
  { id: 'sfx-crowd',        title: 'Synthetic Crowd Bed', category: 'Crowd',   mood: 'Synthetic Ambience', file: 'sfx-6-crowd.wav',   description: 'Synthetic white-noise bed (NOT a real crowd recording)' },
  { id: 'sfx-rain',         title: 'Synthetic Rain Bed',  category: 'Nature',  mood: 'Synthetic Ambience', file: 'sfx-7-rain.wav',    description: 'Synthetic brown-noise bed (NOT a real rain recording)' },
  { id: 'sfx-notification', title: 'Notification',         category: 'UI',      mood: 'Alert',       file: 'sfx-8-notification.wav', description: 'Synthetic 880 Hz short tone (notification alert)' },
];

const PUBLIC_AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');
const FFPROBE_BIN = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';

/**
 * Read real duration + sample rate + channels from a WAV via FFprobe.
 * Returns 0 for any field that cannot be derived — we never fabricate.
 */
function probeAudioFile(absPath: string): {
  duration: number;
  sampleRate: number;
  channels: number;
  size: number;
} {
  const fallback = { duration: 0, sampleRate: 0, channels: 0, size: 0 };
  try {
    if (!existsSync(absPath)) return fallback;
    const size = statSync(absPath).size;
    // V19.1 §4.3: invoke FFprobe to read the real stream metadata.
    const stdout = execFileSync(FFPROBE_BIN, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      absPath,
    ], { encoding: 'utf-8', timeout: 5_000 });
    const probe = JSON.parse(stdout);
    const audioStream = (probe.streams || []).find((s: any) => s.codec_type === 'audio');
    if (!audioStream) return { ...fallback, size };
    return {
      duration: parseFloat(probe.format?.duration || audioStream.duration || '0') || 0,
      sampleRate: parseInt(audioStream.sample_rate || '0', 10) || 0,
      channels: parseInt(audioStream.channels || '0', 10) || 0,
      size,
    };
  } catch {
    // FFprobe unavailable OR file unreadable — return zeros so the UI
    // can render an "asset not available" state rather than fabricated
    // metadata.
    return fallback;
  }
}

function toMetadata(sfx: BuiltinSfx): AudioMetadata {
  const absPath = path.join(PUBLIC_AUDIO_DIR, sfx.file);
  const probe = probeAudioFile(absPath);
  const available = probe.size > 0 && probe.duration > 0;
  return {
    id: sfx.id,
    title: sfx.title,
    artist: 'VidiaForge Library',
    category: sfx.category,
    mood: sfx.mood,
    duration: probe.duration,
    format: 'wav',
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    size: probe.size,
    // Public URL — the browser fetches this directly. Same-origin, so
    // no CORS concerns on Netlify.
    url: `/audio/${sfx.file}`,
    thumbnailUrl: '',
    previewAvailable: available,
    licenseType: 'CC0',
    attributionRequired: false,
    attributionLine: '',
    available,
    source: 'builtin-sfx',
    // Hide description inside `mood` to avoid extending the public type
    // surface; the frontend already shows category + mood.
  };
}

class BuiltinSfxProvider implements AudioCatalogProvider {
  readonly name = 'builtin-sfx';
  // Always configured — these assets ship with the app.
  readonly configured = true;

  private cache: AudioMetadata[] | null = null;

  async listMusic(): Promise<AudioMetadata[]> {
    // V19.1 §4.5: this provider does NOT ship music. The music catalog
    // must come from a licensed external provider. When no external
    // provider is configured, the UI shows an honest empty state.
    return [];
  }

  async listSfx(): Promise<AudioMetadata[]> {
    if (this.cache) return this.cache;
    this.cache = BUILTIN_SFX.map(toMetadata);
    return this.cache;
  }

  async getById(id: string): Promise<AudioMetadata | null> {
    const sfx = BUILTIN_SFX.find((s) => s.id === id);
    if (!sfx) return null;
    return toMetadata(sfx);
  }
}

export function createBuiltinSfxProvider(): AudioCatalogProvider {
  return new BuiltinSfxProvider();
}
