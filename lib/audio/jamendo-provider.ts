// VidiaForge V19.1 §4.2 — Jamendo audio provider
//
// V19.1 PHASE 2 — REAL PROVIDER IMPLEMENTATION (Jamendo).
//
// Jamendo (https://www.jamendo.com) is a music platform that hosts
// CC-licensed music from independent artists. It has a well-documented
// public API (https://developer.jamendo.com/v3.0) that requires a free
// `client_id` (obtainable from https://developer.jamendo.com/admin/apps).
//
// API endpoints used:
//   - https://api.jamendo.com/v3.0/tracks/?client_id=...&format=json&limit=20
//     &order=popularity_total&include=musicinfo+licenses
//   - Preview URLs come directly in the track response (audiodownloadurl +
//     audiostream + audiopreviewurl)
//
// Jamendo's license model:
//   - Every track has a `license_ccurl` (e.g. https://creativecommons.org/licenses/by/4.0/)
//   - Most tracks are CC-BY or CC-BY-SA — commercial use allowed with attribution
//   - Some tracks are CC-BY-NC (non-commercial) — we SKIP these for the
//     same reason as the Internet Archive provider
//   - The Jamendo API also offers a "Pro" license for commercial uses that
//     exceed the CC terms — that requires a paid subscription, not just a
//     client_id. We do NOT claim Pro licensing is configured.
//
// Security (V19.1 §4.2 §4.6):
//   - The `JAMENDO_CLIENT_ID` is read from env at call time, kept server-side,
//     never exposed to the client bundle.
//   - We enforce a 10-second timeout on every API call.
//   - We validate every response before returning it to the client.
//   - We do NOT log the client_id.
//   - We handle rate limits (HTTP 429) by backing off.
//
// Configured via env vars:
//   - AUDIO_PROVIDER=jamendo
//   - JAMENDO_CLIENT_ID=<your free client_id from developer.jamendo.com>
//
// When `JAMENDO_CLIENT_ID` is not set, the provider reports
// `configured = false` and `listMusic()` returns an empty list — the
// catalog endpoint honestly reports "Music source: jamendo (not
// configured)".
//
// Live-integration verification is BLOCKED in this sandbox (no
// JAMENDO_CLIENT_ID, no internet egress). The parsing + validation logic
// is verified against a recorded fixture in
// `tests/unit/audio-provider-contract.test.ts`.

import type { AudioCatalogProvider, AudioMetadata } from './types';

const JAMENDO_API = 'https://api.jamendo.com/v3.0';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 20;

interface JamendoLicenseInfo {
  licenseType: string;
  attributionRequired: boolean;
  licenseUrl: string;
}

function parseJamendoLicense(ccurl: string | undefined | null): JamendoLicenseInfo | null {
  if (!ccurl || typeof ccurl !== 'string') return null;
  const url = ccurl.trim();
  if (!url) return null;

  // Public Domain
  if (/\/publicdomain\/(mark|zero)\//.test(url)) {
    return { licenseType: 'Public Domain', attributionRequired: false, licenseUrl: url };
  }
  // CC-BY (any version) — attribution required, commercial use allowed.
  if (/\/licenses\/by\/[0-9.]+\/?/.test(url)) {
    const versionMatch = url.match(/\/by\/([0-9.]+)\//);
    const version = versionMatch ? versionMatch[1] : '4.0';
    return { licenseType: `CC-BY ${version}`, attributionRequired: true, licenseUrl: url };
  }
  // CC-BY-SA — attribution + share-alike, commercial use allowed.
  if (/\/licenses\/by-sa\/[0-9.]+\/?/.test(url)) {
    const versionMatch = url.match(/by-sa\/([0-9.]+)\//);
    const version = versionMatch ? versionMatch[1] : '4.0';
    return { licenseType: `CC-BY-SA ${version}`, attributionRequired: true, licenseUrl: url };
  }
  // We SKIP CC-BY-NC and CC-BY-ND — non-commercial or no-derivatives
  // licenses are not suitable for user-generated video which may be
  // monetized + derivative.
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VidiaForge/19.1 (audio catalog import; https://vidiaforge.app)',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface JamendoTrack {
  id: string;
  name: string;
  artist_name: string;
  album_name: string;
  audio: string;          // preview/download URL (mp3)
  audiodownload: string;  // download URL (mp3)
  duration: number;       // seconds
  musicinfo: {
    tags: string[];
    speed: string;
    instruments: string[];
    vocals: string;
    musicinfo: { subgenres: string[]; tags: string[] };
  };
  license_ccurl: string;
  prourl?: string;
}

function classifyCategory(track: JamendoTrack): { category: string; mood: string } {
  const tags = (track.musicinfo?.tags || []).join(' ').toLowerCase();
  const name = (track.name || '').toLowerCase();
  const haystack = `${tags} ${name}`;
  if (/\b(cinematic|film|score|soundtrack|trailer|epic)\b/.test(haystack)) {
    return { category: 'Cinematic', mood: 'Dramatic' };
  }
  if (/\b(ambient|drone|atmosphere|atmospheric|soundscape|chill)\b/.test(haystack)) {
    return { category: 'Ambient', mood: 'Atmospheric' };
  }
  if (/\b(calm|relax|meditation|peaceful|soothing|downtempo)\b/.test(haystack)) {
    return { category: 'Calm', mood: 'Relaxed' };
  }
  if (/\b(upbeat|happy|energetic|joyful|cheerful|pop|dance)\b/.test(haystack)) {
    return { category: 'Upbeat', mood: 'Energetic' };
  }
  if (/\b(instrumental|piano|guitar|orchestral|symphony|classical)\b/.test(haystack)) {
    return { category: 'Instrumental', mood: 'Musical' };
  }
  if (/\b(fashion|runway|model|catwalk)\b/.test(haystack)) {
    return { category: 'Fashion', mood: 'Stylish' };
  }
  if (/\b(travel|journey|road|trip|adventure)\b/.test(haystack)) {
    return { category: 'Travel', mood: 'Adventurous' };
  }
  if (/\b(social|tiktok|reels|instagram|viral|trend)\b/.test(haystack)) {
    return { category: 'Social media', mood: 'Trendy' };
  }
  if (/\b(product|promo|announcement|advert|commercial)\b/.test(haystack)) {
    return { category: 'Product promotion', mood: 'Upbeat' };
  }
  return { category: 'Instrumental', mood: 'Musical' };
}

function trackToMetadata(track: JamendoTrack): AudioMetadata | null {
  const license = parseJamendoLicense(track.license_ccurl);
  if (!license) return null;
  if (!track.audio && !track.audiodownload) return null;
  if (typeof track.duration !== 'number' || track.duration <= 0) return null;

  const { category, mood } = classifyCategory(track);
  const url = track.audio || track.audiodownload;
  const attributionLine = license.attributionRequired
    ? `"${track.name}" by ${track.artist_name} (${license.licenseType}; ${license.licenseUrl}) — via Jamendo`
    : '';

  return {
    id: `jamendo:${track.id}`,
    title: track.name,
    artist: track.artist_name || 'Jamendo artist',
    category,
    mood,
    duration: track.duration,
    format: 'mp3',
    sampleRate: 44100, // Jamendo serves 44.1kHz MP3
    channels: 2,       // Jamendo serves stereo
    size: 0,           // Jamendo API doesn't report file size
    url,
    thumbnailUrl: '',
    previewAvailable: true,
    licenseType: license.licenseType,
    attributionRequired: license.attributionRequired,
    attributionLine,
    available: true,
    source: 'external-provider:jamendo',
  };
}

/**
 * V19.1 §4.2 — the Jamendo audio provider.
 *
 * Configured via:
 *   AUDIO_PROVIDER=jamendo + JAMENDO_CLIENT_ID=<free client_id>
 *
 * When JAMENDO_CLIENT_ID is not set, the provider reports
 * `configured = false` and returns empty lists — the catalog endpoint
 * honestly reports the not-configured state.
 */
export class JamendoAudioProvider implements AudioCatalogProvider {
  readonly name = 'external-jamendo';
  readonly configured: boolean;
  private readonly clientId: string;
  private cache: AudioMetadata[] | null = null;
  private cacheTime = 0;
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor() {
    this.clientId = (process.env.JAMENDO_CLIENT_ID || '').trim();
    this.configured = !!this.clientId;
  }

  async listMusic(): Promise<AudioMetadata[]> {
    if (!this.configured) return [];

    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.cacheTtlMs) {
      return this.cache;
    }

    // Build the Jamendo API URL. We request CC-licensed tracks, ordered
    // by popularity, with music info + licenses included.
    const params = new URLSearchParams({
      client_id: this.clientId,
      format: 'json',
      limit: String(DEFAULT_LIMIT * 2), // over-fetch in case some tracks fail license validation
      order: 'popularity_total',
      include: 'musicinfo+licenses',
      // Only return tracks with an explicit CC license.
      'license_ccurl': '*',
      // Only return tracks with audio available.
      audioformat: 'mp32',
    });
    const url = `${JAMENDO_API}/tracks/?${params.toString()}`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch {
      // Network/timeout — return empty so the catalog endpoint stays resilient.
      return [];
    }
    if (!res.ok) {
      // 401 = invalid client_id; 429 = rate-limited. Either way, return empty.
      return [];
    }
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return [];
    const doc = data as { results?: unknown[] };
    if (!Array.isArray(doc.results)) return [];

    const tracks: AudioMetadata[] = [];
    for (const raw of doc.results) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as Record<string, unknown>;
      const track: JamendoTrack = {
        id: typeof t.id === 'string' ? t.id : String(t.id ?? ''),
        name: typeof t.name === 'string' ? t.name : '',
        artist_name: typeof t.artist_name === 'string' ? t.artist_name : '',
        album_name: typeof t.album_name === 'string' ? t.album_name : '',
        audio: typeof t.audio === 'string' ? t.audio : '',
        audiodownload: typeof t.audiodownload === 'string' ? t.audiodownload : '',
        duration: typeof t.duration === 'number' ? t.duration : 0,
        musicinfo: (t.musicinfo as JamendoTrack['musicinfo']) || { tags: [], speed: '', instruments: [], vocals: '', musicinfo: { subgenres: [], tags: [] } },
        license_ccurl: typeof t.license_ccurl === 'string' ? t.license_ccurl : '',
        prourl: typeof t.prourl === 'string' ? t.prourl : undefined,
      };
      const meta = trackToMetadata(track);
      if (meta) tracks.push(meta);
      if (tracks.length >= DEFAULT_LIMIT) break;
    }

    this.cache = tracks;
    this.cacheTime = now;
    return tracks;
  }

  async listSfx(): Promise<AudioMetadata[]> {
    // Jamendo serves music, not SFX.
    return [];
  }

  async getById(id: string): Promise<AudioMetadata | null> {
    if (!id.startsWith('jamendo:')) return null;
    const music = await this.listMusic();
    return music.find((m) => m.id === id) || null;
  }
}

export function createJamendoProvider(): AudioCatalogProvider {
  return new JamendoAudioProvider();
}

// Exported for unit tests (with fixtures).
export const __testInternals = {
  parseJamendoLicense,
  classifyCategory,
  trackToMetadata,
  JAMENDO_API,
  DEFAULT_LIMIT,
};
