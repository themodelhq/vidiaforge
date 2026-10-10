// VidiaForge V19.1 §4.2 — External music provider (pluggable)
//
// V19.1 PHASE 2 — REAL PROVIDER INTEGRATION.
//
// This file ships TWO genuine provider adapters + a factory:
//
//   1. InternetArchiveAudioProvider — calls the Internet Archive's
//      public API (no auth required). Returns CC-licensed + public-domain
//      audio with accurate metadata + license info.
//      Configured via: AUDIO_PROVIDER=internet-archive
//
//   2. JamendoAudioProvider — calls the Jamendo API (requires a free
//      JAMENDO_CLIENT_ID). Returns CC-licensed music from independent
//      artists.
//      Configured via: AUDIO_PROVIDER=jamendo + JAMENDO_CLIENT_ID=<id>
//
//   3. NoExternalMusicProvider — the honest default. Returns empty lists
//      when no provider is configured. The UI renders "No music catalog
//      configured."
//
// Each provider implements the AudioCatalogProvider interface. The
// factory reads `process.env.AUDIO_PROVIDER` at call time so the
// provider can be reconfigured without a code change.
//
// V19.1 §4.6 — SECURITY:
//   - Provider API keys (e.g. JAMENDO_CLIENT_ID) are read from env on
//     the SERVER only. They are never bundled into the client.
//   - The catalog endpoint (`/api/audio/catalog`) is `runtime = 'nodejs'`.
//   - We do NOT log signed URLs, authorization headers, or credentials.
//   - Every provider response is validated before being returned to the
//     client.
//   - Every provider enforces a 10-second timeout per request.
//   - Rate limits (HTTP 429) cause the provider to return an empty list
//     rather than retry-storming the upstream API.
//
// V19.1 §4.5 — Acceptance: "The music library does not present generated
// test tones as real music." The built-in SFX provider is honest about
// not shipping music. The external providers return ONLY genuinely
// licensed audio — never fabricated tracks.

import type { AudioCatalogProvider, AudioMetadata } from './types';
import { InternetArchiveAudioProvider } from './internet-archive-provider';
import { JamendoAudioProvider } from './jamendo-provider';

/**
 * The "none" provider — used when no external music catalog is
 * configured. Returns empty music lists. This is the honest default
 * so the UI never presents fake tracks as real music.
 */
class NoExternalMusicProvider implements AudioCatalogProvider {
  readonly name = 'external-none';
  readonly configured = false;

  async listMusic(): Promise<AudioMetadata[]> {
    return [];
  }

  async listSfx(): Promise<AudioMetadata[]> {
    // SFX come from the built-in provider, not the external one.
    return [];
  }

  async getById(): Promise<AudioMetadata | null> {
    return null;
  }
}

/**
 * Factory: returns the configured external music provider. Reads env
 * vars at call time (so the provider can be reconfigured without a
 * code change). When no provider is configured, returns the "none"
 * provider which honestly returns empty lists.
 *
 * This factory is the SINGLE place to add a new external music
 * provider — extend the switch below + add a new file implementing
 * AudioCatalogProvider.
 */
export function createExternalMusicProvider(): AudioCatalogProvider {
  const providerName = (process.env.AUDIO_PROVIDER || 'none').toLowerCase();
  switch (providerName) {
    case 'internet-archive':
    case 'ia':
      // V19.1 PHASE 2 — genuine Internet Archive adapter. Public API,
      // no credentials required.
      return new InternetArchiveAudioProvider();
    case 'jamendo':
      // V19.1 PHASE 2 — genuine Jamendo adapter. Requires JAMENDO_CLIENT_ID.
      // When the client_id is missing, the adapter reports `configured=false`
      // and returns empty lists (honest not-configured state).
      return new JamendoAudioProvider();
    case 'none':
    default:
      return new NoExternalMusicProvider();
  }
}

/**
 * Returns a human-readable description of the configured external
 * music provider. Used by the /api/audio/catalog endpoint so the
 * UI can show "Music source: <provider name> (configured)" or
 * "Music source: not configured".
 */
export function describeExternalMusicProvider(): {
  name: string;
  configured: boolean;
} {
  const provider = createExternalMusicProvider();
  return { name: provider.name, configured: provider.configured };
}
