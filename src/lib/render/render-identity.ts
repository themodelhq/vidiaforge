// VidiaForge — Render Identity computation.
// V6 §12: deterministic identity = SHA256(canonical(projectId + timelineHash +
// format + resolution + fps + bitrate)). Used for race-safe deduplication
// via a database partial unique index.

import { createHash } from 'crypto';

/**
 * Compute a deterministic render identity from the render-affecting parameters.
 * Two requests with the same projectId, timelineHash, format, resolution, fps,
 * and bitrate produce the SAME renderIdentity.
 */
export function computeRenderIdentity(params: {
  projectId: string;
  timelineHash: string;
  format: string;
  resolution: string;
  fps: number;
  bitrate: string;
}): string {
  // Canonicalize: lowercase + sort keys + concatenate with separators
  // This ensures that parameter order doesn't affect the hash.
  const canonical = [
    params.projectId,
    params.timelineHash,
    params.format.toLowerCase(),
    params.resolution.toLowerCase(),
    String(params.fps),
    params.bitrate.toLowerCase(),
  ].join('|');

  return createHash('sha256').update(canonical).digest('hex');
}
