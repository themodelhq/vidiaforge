// VidiaForge V19.1 §4.2 — Audio catalog provider abstraction
//
// Provides a single, well-typed interface for the audio library so the
// frontend can fetch real audio metadata without knowing whether the
// catalog is sourced from built-in SFX, an external licensed music
// provider, or both.
//
// V19.1 §4.3 — AudioMetadata: the canonical shape exposed via the API.
// Every field is derived from a real asset — no fabricated durations,
// no fabricated artists, no fabricated licensing information.
//
// Provider integration contract:
//   - `listMusic()` → returns music tracks (licensed catalog if
//     configured; empty list otherwise — never fabricated).
//   - `listSfx()` → returns the built-in real SFX (noise-based WAVs
//     generated with FFmpeg). These ARE legitimately usable as
//     production sound effects — they are not "fake music".
//   - `getById(id)` → returns a single track by stable ID.
//
// Future external providers (Mubert, Artlist, Epidemic Sound, Free
// Music Archive, etc.) implement this interface and are wired in
// through the factory based on environment variables. Credentials are
// kept server-side — never exposed to client bundles.

export interface AudioMetadata {
  /** Stable identifier — must not change for the same asset. */
  id: string;
  /** Track title. */
  title: string;
  /** Creator / attribution. Empty string when unknown (never fabricated). */
  artist: string;
  /** Category — e.g. "Cinematic", "Ambient", "SFX-Whoosh". */
  category: string;
  /** Sub-category / mood. Empty string when not applicable. */
  mood: string;
  /** Real duration in seconds, derived from the actual file metadata. */
  duration: number;
  /** Audio format — e.g. "wav", "mp3". */
  format: string;
  /** Sample rate in Hz (0 when unknown). */
  sampleRate: number;
  /** Channel count (0 when unknown). */
  channels: number;
  /** File size in bytes (0 when unknown / external URL). */
  size: number;
  /** Storage key OR public URL — what the browser fetches to play. */
  url: string;
  /** Thumbnail / waveform image URL (empty when not available). */
  thumbnailUrl: string;
  /** Whether a preview is playable. Always true for built-in SFX. */
  previewAvailable: boolean;
  /** License type — e.g. "CC0", "Royalty-free", "Licensed". */
  licenseType: string;
  /** Whether attribution is required for this asset. */
  attributionRequired: boolean;
  /** Human-readable attribution line (empty when not required). */
  attributionLine: string;
  /** Whether the asset is currently available (false = missing/failed). */
  available: boolean;
  /** Source — "builtin-sfx" | "external-provider:<name>" | "user-upload". */
  source: string;
}

export interface AudioCatalogProvider {
  /** Provider name — "builtin-sfx", "external-mubert", etc. */
  readonly name: string;
  /** Whether the provider is configured (env vars set, credentials present). */
  readonly configured: boolean;
  /** List music tracks. Returns empty list when no catalog is configured. */
  listMusic(): Promise<AudioMetadata[]>;
  /** List built-in SFX. Returns real noise-based SFX assets. */
  listSfx(): Promise<AudioMetadata[]>;
  /** Look up a single track by stable ID across music + SFX. */
  getById(id: string): Promise<AudioMetadata | null>;
}
