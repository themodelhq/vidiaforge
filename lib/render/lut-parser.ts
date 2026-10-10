// VidiaForge — LUT (.cube) Parser + Resolver
// V19 §32: Parses Adobe/Resolve .cube 3D LUT files, resolves storageKey →
// local file path via getStorage(), and caches parsed LUTs by SHA-256 of
// their contents. Returns FFmpeg-compatible file paths for the lut3d filter.
//
// .cube format reference:
//   TITLE "My LUT"
//   LUT_3D_SIZE 32           // 32x32x32 cube
//   DOMAIN_MIN 0.0 0.0 0.0   // optional, default 0 0 0
//   DOMAIN_MAX 1.0 1.0 1.0   // optional, default 1 1 1
//   <R G B triplets, one per line>
//
// The data is row-major with R varying fastest, then G, then B (B slowest).
// FFmpeg's lut3d filter accepts the .cube file directly via `lut3d=file=PATH`
// so we do NOT need to convert — just validate + return the on-disk path.

import { createHash } from 'crypto';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { getStorage } from '../storage';

/**
 * Parsed LUT structure. The data array length = size^3 * 3 (RGB triplets).
 */
export interface ParsedLut {
  title?: string;
  size: number;            // N where the cube is N×N×N
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** Flat array of RGB triplets (length = size^3 * 3) */
  data: number[];
}

/**
 * Result returned to the render service — the local file path FFmpeg should
 * reference + the SHA-256 hash used for caching.
 */
export interface ResolvedLut {
  /** Absolute on-disk path to the .cube file */
  filePath: string;
  /** SHA-256 of file contents (used for cache key) */
  sha256: string;
  /** Parsed structure (for validation) */
  parsed: ParsedLut;
  /** True if this was a cache hit (no re-download performed) */
  cached: boolean;
}

// === In-memory cache: sha256 → ResolvedLut ===
const lutCache = new Map<string, ResolvedLut>();

// === Tmp directory for downloaded LUTs (created lazily on first use) ===
let lutTmpDirPromise: Promise<string> | null = null;

async function ensureLutTmpDir(): Promise<string> {
  if (!lutTmpDirPromise) {
    lutTmpDirPromise = mkdtemp(path.join(tmpdir(), 'vf-lut-'));
  }
  return lutTmpDirPromise;
}

/**
 * Parse a .cube file's text contents into a ParsedLut structure.
 * Throws on malformed input (missing LUT_3D_SIZE, wrong triplet count, etc.).
 *
 * Validation rules:
 *   - LUT_3D_SIZE is REQUIRED (any value 2..256 is accepted)
 *   - Total triplet count MUST equal size^3
 *   - DOMAIN_MIN/MAX must be 3 floats each
 *   - Each data row must have 3 floats (R G B), values clamped to [0..1]
 */
export function parseCubeLut(text: string): ParsedLut {
  const lines = text.split(/\r?\n/);
  let title: string | undefined;
  let size: number | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const data: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip comments (# ...) and trim whitespace
    const hashIdx = raw.indexOf('#');
    const line = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim();
    if (!line) continue;

    // Header lines: keyword + args
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      const m = line.match(/TITLE\s+"([^"]*)"/i);
      if (m) title = m[1];
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/);
      const v = parseInt(parts[1], 10);
      if (!Number.isFinite(v) || v < 2 || v > 256) {
        throw new Error(`Invalid LUT_3D_SIZE at line ${i + 1}: "${line}"`);
      }
      size = v;
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Invalid DOMAIN_MIN at line ${i + 1}: "${line}"`);
      }
      domainMin = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Invalid DOMAIN_MAX at line ${i + 1}: "${line}"`);
      }
      domainMax = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE') || upper.startsWith('LUT_3D_INPUT')) {
      // We don't support 1D LUTs or input transfer LUTs — skip + warn in console.
      console.warn(`[lut-parser] unsupported directive at line ${i + 1}: "${line}" — ignored`);
      continue;
    }

    // Otherwise — data row: R G B
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
      // Not a data row — likely a header we don't recognize. Skip with a warning.
      continue;
    }
    data.push(
      clamp01(parts[0]),
      clamp01(parts[1]),
      clamp01(parts[2])
    );
  }

  if (!size) {
    throw new Error('LUT file is missing LUT_3D_SIZE directive');
  }
  const expected = size * size * size * 3;
  if (data.length !== expected) {
    throw new Error(
      `LUT data triplet count mismatch: expected ${expected} (= ${size}^3 * 3), got ${data.length / 3} triplets`
    );
  }

  return { title, size, domainMin, domainMax, data };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Compute SHA-256 of file contents.
 */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Resolve a LUT reference (storageKey OR filePath) to a local on-disk path
 * suitable for FFmpeg's `lut3d=file=PATH` filter.
 *
 * Caching:
 *   - In-memory cache keyed by SHA-256 of file contents.
 *   - If the same LUT is referenced by multiple clips, it's downloaded once.
 *
 * Throws if:
 *   - Both storageKey and filePath are missing
 *   - Storage download fails
 *   - .cube parsing fails (malformed file)
 */
export async function resolveLutFile(ref: {
  storageKey?: string;
  filePath?: string;
}): Promise<ResolvedLut> {
  // 1. Source the bytes
  let buffer: Buffer;
  if (ref.filePath) {
    // Already on disk — read it
    const { readFile } = await import('fs/promises');
    buffer = await readFile(ref.filePath);
  } else if (ref.storageKey) {
    // Stream-download from storage into a buffer (LUTs are small — typically
    // <1 MB — so buffering is safe, unlike video files).
    const storage = getStorage();
    const stream = await storage.getObjectStream(ref.storageKey);
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
        total += value.byteLength;
      }
    }
    buffer = Buffer.concat(chunks, total);
  } else {
    throw new Error('LUT reference must specify either storageKey or filePath');
  }

  // 2. Compute SHA-256 for cache key
  const hash = sha256(buffer);

  // 3. Check in-memory cache
  const cached = lutCache.get(hash);
  if (cached) {
    // Verify the cached file still exists on disk
    try {
      await stat(cached.filePath);
      return { ...cached, cached: true };
    } catch {
      // File was removed (tmp cleared) — fall through + re-write
      lutCache.delete(hash);
    }
  }

  // 4. Parse to validate
  const text = buffer.toString('utf-8');
  const parsed = parseCubeLut(text);

  // 5. Write to a per-hash tmp file (idempotent — same hash → same path)
  const tmpDir = await ensureLutTmpDir();
  const filePath = path.join(tmpDir, `${hash}.cube`);
  try {
    await stat(filePath);
    // Already exists on disk — re-use
    const resolved: ResolvedLut = { filePath, sha256: hash, parsed, cached: false };
    lutCache.set(hash, resolved);
    return resolved;
  } catch {
    // Doesn't exist — write it
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    const resolved: ResolvedLut = { filePath, sha256: hash, parsed, cached: false };
    lutCache.set(hash, resolved);
    return resolved;
  }
}

/**
 * Clear the in-memory LUT cache. Intended for tests + worker shutdown hooks.
 * Does NOT delete on-disk tmp files — those live in the OS tmpdir and are
 * cleaned by the OS or by an explicit `cleanupLutTmpDir()` call.
 */
export function clearLutCache(): void {
  lutCache.clear();
}

/**
 * Best-effort cleanup of the on-disk tmp directory holding downloaded LUTs.
 * Safe to call multiple times.
 */
export async function cleanupLutTmpDir(): Promise<void> {
  if (!lutTmpDirPromise) return;
  const dir = await lutTmpDirPromise;
  lutTmpDirPromise = null;
  lutCache.clear();
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort — tmp dir may already be gone
  }
}
