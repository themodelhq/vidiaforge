// VidiaForge — Render output key helper (idempotency)
//
// Same renderJobId + format ALWAYS produces the same object key. This is the
// foundation of render idempotency: if a render job is retried (after a
// transient Redis/network failure), the worker checks if the output object
// already exists at this key and — if so — skips the FFmpeg run entirely and
// just finalizes the DB row. This avoids wasted compute + storage write costs
// on retries.
//
// Key shape: `renders/{renderJobId}/output.{ext}`
//
//   - Lives under a per-job subdirectory so cleanup is one prefix-delete.
//   - Extension comes from the chosen RenderOptions.format (mp4/webm/mov).
//   - Includes the renderJobId so the same project rendered twice (with
//     different RenderJob rows) produces two distinct outputs.

import type { RenderOptions } from './types';

/**
 * Return a deterministic object-storage key for a render job's primary output.
 * Calling this twice with the same arguments always returns the same string.
 */
export function getRenderOutputKey(renderJobId: string, format: RenderOptions['format']): string {
  if (!renderJobId || typeof renderJobId !== 'string') {
    throw new Error('renderJobId must be a non-empty string');
  }
  // Strip any leading/trailing slashes / dots to keep the key clean.
  const id = renderJobId.replace(/[/\\.]/g, '').trim();
  if (!id) throw new Error('renderJobId must not be empty after sanitization');
  const ext = (format || 'mp4').toLowerCase();
  return `renders/${id}/output.${ext}`;
}

/**
 * Returns the directory prefix for a render job. Useful for listing / deleting
 * all artifacts (output + thumbnails + manifest) for a single render job.
 */
export function getRenderOutputPrefix(renderJobId: string): string {
  const id = renderJobId.replace(/[/\\.]/g, '').trim();
  if (!id) throw new Error('renderJobId must not be empty after sanitization');
  return `renders/${id}/`;
}
