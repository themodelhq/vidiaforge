// VidiaForge V19.1 §4.2 — Audio provider factory + index
//
// Single entry point for resolving the active audio catalog. The
// frontend hits GET /api/audio/catalog which delegates to this module.
//
// The aggregate catalog is the union of:
//   - built-in SFX (always available)
//   - external music (available when AUDIO_PROVIDER is configured)
//
// V19.1 PHASE 2 — REAL PROVIDER INTEGRATION.
//   - AUDIO_PROVIDER=internet-archive → Internet Archive public API (no auth)
//   - AUDIO_PROVIDER=jamendo          → Jamendo API (requires JAMENDO_CLIENT_ID)
//   - AUDIO_PROVIDER=none (default)   → honest empty state
//
// The factory caches the providers so FFprobe is only run once per
// process for the built-in SFX.

import { createBuiltinSfxProvider } from './builtin-sfx-provider';
import { createExternalMusicProvider } from './external-provider';
import type { AudioCatalogProvider, AudioMetadata } from './types';

class AggregateAudioProvider implements AudioCatalogProvider {
  readonly name = 'aggregate';
  readonly sfxProvider: AudioCatalogProvider;
  readonly musicProvider: AudioCatalogProvider;

  constructor() {
    this.sfxProvider = createBuiltinSfxProvider();
    this.musicProvider = createExternalMusicProvider();
  }

  get configured(): boolean {
    // Aggregate is "configured" if EITHER provider is configured.
    return this.sfxProvider.configured || this.musicProvider.configured;
  }

  async listMusic(): Promise<AudioMetadata[]> {
    // V19.1 §4.5: never fabricate. If no external provider is
    // configured, return an empty list — the UI shows an honest empty
    // state, not fake tracks.
    if (!this.musicProvider.configured) return [];
    try {
      return await this.musicProvider.listMusic();
    } catch {
      // External provider errored — return empty so the UI shows the
      // empty state rather than crashing the catalog fetch.
      return [];
    }
  }

  async listSfx(): Promise<AudioMetadata[]> {
    try {
      return await this.sfxProvider.listSfx();
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<AudioMetadata | null> {
    // Try SFX first (always configured), then music.
    const sfx = await this.sfxProvider.getById(id);
    if (sfx) return sfx;
    return this.musicProvider.getById(id);
  }
}

let cached: AggregateAudioProvider | null = null;

/**
 * Returns the singleton aggregate audio provider. Cached so FFprobe is
 * only invoked once per process for the built-in SFX.
 *
 * NOTE: The cache is per-process. Tests that need to exercise the
 * provider-selection logic with different env vars should call
 * `createExternalMusicProvider()` directly (which reads env at call
 * time) rather than going through this cached singleton.
 */
export function getAudioProvider(): AudioCatalogProvider {
  if (!cached) cached = new AggregateAudioProvider();
  return cached;
}

/**
 * Reset the singleton cache. Used by tests that change AUDIO_PROVIDER
 * between test cases. NOT for production use.
 */
export function __resetAudioProviderCacheForTests(): void {
  cached = null;
}

// Re-export the public types + provider helpers for tests + route handlers.
export type { AudioCatalogProvider, AudioMetadata } from './types';
export { createBuiltinSfxProvider } from './builtin-sfx-provider';
export { createExternalMusicProvider, describeExternalMusicProvider } from './external-provider';
export { createInternetArchiveProvider, InternetArchiveAudioProvider } from './internet-archive-provider';
export { createJamendoProvider, JamendoAudioProvider } from './jamendo-provider';
