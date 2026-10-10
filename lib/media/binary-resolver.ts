// VidiaForge — Media binary resolver (FFmpeg + FFprobe)
//
// Resolves the `ffmpeg` and `ffprobe` executable paths in priority order:
//   1. FFMPEG_PATH / FFPROBE_PATH env vars (explicit override — wins if set)
//   2. ffmpeg-static / ffprobe-static npm packages (dynamic import, try/catch)
//   3. System PATH (via `which ffmpeg` on Unix — the `which` BINARY, not the
//      `command` shell builtin which cannot be exec'd with shell:false)
//      On Windows: `where ffmpeg` (the Windows built-in `where.exe`).
//      Fallback: `/bin/sh -lc 'command -v ffmpeg'` if `which` is missing
//      (e.g. on Alpine, which installs `which` in the `which` apk package but
//      not by default).
//   4. Common container paths: /usr/bin/ffmpeg, /usr/local/bin/ffmpeg, ...
//
// On first successful resolution, logs the path + version line.
// Memoizes the result so subsequent calls are free.
//
// Throws MediaBinaryUnavailableError if NO candidate is found, with a clear
// message listing every source it tried.
//
// V4-S2 (P1-32/P1-33): the previous `whichOnPath` used `execFile('command',
// ['-v', 'ffmpeg'])` — but `command` is a shell BUILTIN, not an executable
// file. `execFile` with `shell: false` spawns the binary directly without a
// shell, so Node tried to find a file named `command` in PATH (which doesn't
// exist) → ENOENT → caught silently → returned null → "ffmpeg not in PATH"
// even when ffmpeg was at /usr/bin/ffmpeg. The render pipeline therefore
// failed every render with `MediaProcessorUnavailableError` despite FFmpeg
// being installed. This rewrite uses the real `which` binary (or `/bin/sh
// -lc 'command -v ffmpeg'` as a fallback) so the lookup actually works.
//
// Used by:
//   - mini-services/worker/src/index.ts (startup validation)
//   - any code path that wants to surface "is FFmpeg available?" to logs/UI
//     without spawning a process directly.
//
// Side effect: when a binary is found, FFMPEG_PATH / FFPROBE_PATH env vars are
// populated (if not already set) so the legacy FFmpegMediaProcessor.which()
// helper also resolves to the same binary — single source of truth.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';

const execFileP = promisify(execFile);

export interface ResolvedBinary {
  /** Absolute path to the binary. */
  path: string;
  /** First line of `<binary> -version` output, e.g. `ffmpeg version 6.0 Copyright ...`. */
  version: string;
  /** Source of the resolution, for logging. */
  source: 'env' | 'npm-package' | 'system-path' | 'container-default';
}

/**
 * Thrown when neither ffmpeg nor ffprobe can be found.
 * The error message lists every source that was tried so the operator can
 * immediately see what's missing (e.g. "no ffmpeg in PATH, no ffmpeg-static
 * package, /usr/bin/ffmpeg does not exist").
 */
export class MediaBinaryUnavailableError extends Error {
  readonly code = 'MEDIA_BINARY_UNAVAILABLE';
  constructor(
    readonly binary: 'ffmpeg' | 'ffprobe',
    message: string
  ) {
    super(`[${binary}] ${message}`);
    this.name = 'MediaBinaryUnavailableError';
  }
}

// Memoized resolutions — first call resolves + logs, subsequent calls return cache.
let ffmpegCache: ResolvedBinary | null = null;
let ffprobeCache: ResolvedBinary | null = null;

async function existsExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function getVersion(p: string): Promise<string> {
  const { stdout } = await execFileP(p, ['-version'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.split(/\r?\n/)[0].trim();
}

async function tryCandidate(
  p: string,
  source: ResolvedBinary['source']
): Promise<ResolvedBinary | null> {
  if (!p) return null;
  if (!(await existsExecutable(p))) return null;
  try {
    const version = await getVersion(p);
    return { path: p, version, source };
  } catch {
    // Binary exists but `-version` failed — treat as broken / unavailable.
    return null;
  }
}

async function whichOnPath(bin: string): Promise<string | null> {
  const isWin = process.platform === 'win32';
  if (isWin) {
    // Windows: `where.exe ffmpeg` is the equivalent of Unix `which`.
    try {
      const { stdout } = await execFileP('where', [bin]);
      const p = stdout.split(/\r?\n/)[0].trim();
      return p || null;
    } catch {
      return null;
    }
  }
  // Unix: try the real `which` binary FIRST. `which` lives at /usr/bin/which
  // on most distros (Debian, Ubuntu, Alpine with `apk add which`). It returns
  // the absolute path of the first matching executable on PATH.
  try {
    const { stdout } = await execFileP('which', [bin]);
    const p = stdout.split(/\r?\n/)[0].trim();
    if (p) return p;
  } catch {
    // Fall through to the /bin/sh fallback.
  }
  // Fallback: use /bin/sh with `command -v` — this is the POSIX-blessed way
  // to look up a binary from a shell context. The `-lc` form sources the
  // login profile so PATH includes anything set in /etc/profile (e.g. the
  // nvm-installed ffmpeg on dev machines).
  try {
    const { stdout } = await execFileP('/bin/sh', ['-lc', `command -v ${bin}`]);
    const p = stdout.split(/\r?\n/)[0].trim();
    return p || null;
  } catch {
    return null;
  }
}

async function loadFfmpegStatic(): Promise<string | null> {
  try {
    // ffmpeg-static exports the binary path as `module.default`.
    const mod: any = await import('ffmpeg-static');
    if (mod && typeof mod.default === 'string' && mod.default.length > 0) {
      return mod.default;
    }
  } catch {
    // ffmpeg-static not installed — fall through to other sources.
  }
  return null;
}

async function loadFfprobeStatic(): Promise<string | null> {
  try {
    // ffprobe-static exports `{ path: string, ... }` keyed by platform.
    const mod: any = await import('ffprobe-static');
    if (mod && typeof mod.path === 'string' && mod.path.length > 0) {
      return mod.path;
    }
  } catch {
    // ffprobe-static not installed — fall through.
  }
  return null;
}

/**
 * Resolve the `ffmpeg` binary. Memoized after first successful call.
 *
 * @throws MediaBinaryUnavailableError if no ffmpeg is found in any of the
 *   configured sources.
 */
export async function resolveFfmpeg(): Promise<ResolvedBinary> {
  if (ffmpegCache) return ffmpegCache;

  const tried: string[] = [];
  const candidates: Array<{ path: string; source: ResolvedBinary['source'] }> = [];

  // 1. Explicit env var override
  if (process.env.FFMPEG_PATH) {
    candidates.push({ path: process.env.FFMPEG_PATH, source: 'env' });
    tried.push(`env FFMPEG_PATH=${process.env.FFMPEG_PATH}`);
  }

  // 2. ffmpeg-static npm package (bundled binary)
  const staticPath = await loadFfmpegStatic();
  if (staticPath) {
    candidates.push({ path: staticPath, source: 'npm-package' });
    tried.push(`npm package ffmpeg-static → ${staticPath}`);
  } else {
    tried.push('npm package ffmpeg-static (not installed)');
  }

  // 3. System PATH
  const pathWhich = await whichOnPath('ffmpeg');
  if (pathWhich) {
    candidates.push({ path: pathWhich, source: 'system-path' });
    tried.push(`system PATH → ${pathWhich}`);
  } else {
    tried.push('system PATH (ffmpeg not on PATH)');
  }

  // 4. Common container default locations
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    candidates.push({ path: p, source: 'container-default' });
    tried.push(`container default ${p}`);
  }

  for (const c of candidates) {
    const resolved = await tryCandidate(c.path, c.source);
    if (resolved) {
      ffmpegCache = resolved;
      // Mirror the resolution into the env var so the legacy
      // FFmpegMediaProcessor.which() helper (which only reads env / PATH)
      // uses the same binary — single source of truth.
      if (!process.env.FFMPEG_PATH) process.env.FFMPEG_PATH = resolved.path;
      console.log(
        `[media:binary-resolver] ffmpeg → ${resolved.path} (source=${resolved.source}, "${resolved.version}")`
      );
      return resolved;
    }
  }

  throw new MediaBinaryUnavailableError(
    'ffmpeg',
    `no usable ffmpeg binary found. Tried:\n  - ${tried.join('\n  - ')}\n` +
      'Fix: set FFMPEG_PATH, install the ffmpeg-static npm package, install ffmpeg system-wide, ' +
      'or use a Docker image that includes ffmpeg (e.g. oven/bun:1-alpine + `apk add ffmpeg`).'
  );
}

/**
 * Resolve the `ffprobe` binary. Memoized after first successful call.
 *
 * @throws MediaBinaryUnavailableError if no ffprobe is found in any of the
 *   configured sources.
 */
export async function resolveFfprobe(): Promise<ResolvedBinary> {
  if (ffprobeCache) return ffprobeCache;

  const tried: string[] = [];
  const candidates: Array<{ path: string; source: ResolvedBinary['source'] }> = [];

  // 1. Explicit env var override
  if (process.env.FFPROBE_PATH) {
    candidates.push({ path: process.env.FFPROBE_PATH, source: 'env' });
    tried.push(`env FFPROBE_PATH=${process.env.FFPROBE_PATH}`);
  }

  // 2. ffprobe-static npm package
  const staticPath = await loadFfprobeStatic();
  if (staticPath) {
    candidates.push({ path: staticPath, source: 'npm-package' });
    tried.push(`npm package ffprobe-static → ${staticPath}`);
  } else {
    tried.push('npm package ffprobe-static (not installed)');
  }

  // 3. System PATH
  const pathWhich = await whichOnPath('ffprobe');
  if (pathWhich) {
    candidates.push({ path: pathWhich, source: 'system-path' });
    tried.push(`system PATH → ${pathWhich}`);
  } else {
    tried.push('system PATH (ffprobe not on PATH)');
  }

  // 4. Common container default locations
  for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe']) {
    candidates.push({ path: p, source: 'container-default' });
    tried.push(`container default ${p}`);
  }

  for (const c of candidates) {
    const resolved = await tryCandidate(c.path, c.source);
    if (resolved) {
      ffprobeCache = resolved;
      if (!process.env.FFPROBE_PATH) process.env.FFPROBE_PATH = resolved.path;
      console.log(
        `[media:binary-resolver] ffprobe → ${resolved.path} (source=${resolved.source}, "${resolved.version}")`
      );
      return resolved;
    }
  }

  throw new MediaBinaryUnavailableError(
    'ffprobe',
    `no usable ffprobe binary found. Tried:\n  - ${tried.join('\n  - ')}\n` +
      'Fix: set FFPROBE_PATH, install the ffprobe-static npm package, install ffmpeg system-wide ' +
      '(ffprobe ships with ffmpeg), or use a Docker image that includes ffprobe.'
  );
}

/** Test-only: clear the memoized resolutions. Not used in production code paths. */
export function __resetBinaryResolverCache(): void {
  ffmpegCache = null;
  ffprobeCache = null;
}
