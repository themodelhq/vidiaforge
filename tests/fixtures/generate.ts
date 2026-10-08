// VidiaForge — Test fixture generator
//
// Generates deterministic test media files for the render smoke test
// (tests/render-smoke.test.ts), the media-ingestion integration test,
// and the E2E test.
//
// Outputs:
//   tests/fixtures/sample-video.mp4 — 3s 640x480 30fps H.264 video
//                                     with testsrc lavfi + sine audio
//   tests/fixtures/sample-audio.wav — 3s 440Hz sine wave PCM 16-bit
//
// HONEST: if FFmpeg is not available on PATH, this script prints a clear
// message and exits 1. It NEVER silently produces fake files.
//
// Usage:
//   bun tests/fixtures/generate.ts
//
// Or via the package.json script:
//   bun run fixtures:generate

import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import path from 'path';
import process from 'process';

const FIXTURES_DIR = path.dirname(new URL(import.meta.url).pathname);
const VIDEO_PATH = path.join(FIXTURES_DIR, 'sample-video.mp4');
const AUDIO_PATH = path.join(FIXTURES_DIR, 'sample-audio.wav');

function log(msg: string): void {
  console.log(`[fixtures] ${msg}`);
}

function error(msg: string): void {
  console.error(`[fixtures] ${msg}`);
}

/**
 * Detect FFmpeg on PATH. Returns the path to the binary, or null if
 * not found. Mirrors the MediaBinaryResolver's system-PATH tier so
 * the generator and the worker agree on what "available" means.
 */
function findFfmpeg(): string | null {
  // Try a list of well-known discovery methods:
  //   1. `which ffmpeg` (Linux/macOS — standalone binary, not a shell builtin)
  //   2. `where ffmpeg` (Windows)
  //   3. FFMPEG_PATH env var
  //   4. Common container paths: /usr/bin/ffmpeg, /usr/local/bin/ffmpeg
  //
  // NOTE: `command -v ffmpeg` is a shell builtin and does NOT work via
  // execFileSync without `shell: true`. We use `which` instead — it's
  // a standalone binary on Linux/macOS and works the same way.
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    candidates.push(p);
  }
  // Try `which` (Linux/macOS) or `where` (Windows) to find on PATH.
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where' : 'which';
    const stdout = execFileSync(cmd, ['ffmpeg'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    const p = stdout.split(/\r?\n/)[0].trim();
    if (p) candidates.unshift(p);
  } catch {
    // `which` not available OR ffmpeg not on PATH — fall through to candidates.
  }
  for (const c of candidates) {
    try {
      // Verify the binary exists + is executable.
      const st = statSync(c);
      if (st.isFile() && (st.mode & 0o111)) {
        return c;
      }
    } catch {
      // Doesn't exist or inaccessible — try the next candidate.
    }
  }
  return null;
}

function fileExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function generateVideo(ffmpegPath: string): void {
  // Build the FFmpeg command:
  //   -f lavfi -i testsrc=duration=3:size=640x480:rate=30
  //   -f lavfi -i sine=frequency=440:duration=3
  //   -c:v libx264 -c:a pcm_s16le -pix_fmt yuv420p -y <output>
  //
  // The testsrc lavfi source produces a color-bar + counter pattern
  // that's deterministic across FFmpeg versions. The sine source is
  // a pure 440Hz tone. Together they exercise the render pipeline
  // (video decode + audio decode + re-encode).
  //
  // We use pcm_s16le for audio (uncompressed PCM) to avoid AAC encoder
  // quirks across FFmpeg builds.
  const args = [
    '-f', 'lavfi',
    '-i', 'testsrc=duration=3:size=640x480:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-c:a', 'pcm_s16le',
    '-pix_fmt', 'yuv420p',
    '-shortest',
    '-y',
    VIDEO_PATH,
  ];

  try {
    execFileSync(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `FFmpeg failed to generate sample-video.mp4: ${msg}\n` +
      `Command: ${ffmpegPath} ${args.join(' ')}`
    );
  }

  if (!fileExists(VIDEO_PATH)) {
    throw new Error(
      `FFmpeg exited 0 but did not produce ${VIDEO_PATH}. Check the lavfi sources.`
    );
  }

  log(
    `Wrote tests/fixtures/sample-video.mp4 (3s 640x480 30fps H.264, ${formatBytes(fileSize(VIDEO_PATH))})`
  );
}

function generateAudio(ffmpegPath: string): void {
  const args = [
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=3',
    '-c:a', 'pcm_s16le',
    '-y',
    AUDIO_PATH,
  ];

  try {
    execFileSync(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `FFmpeg failed to generate sample-audio.wav: ${msg}\n` +
      `Command: ${ffmpegPath} ${args.join(' ')}`
    );
  }

  if (!fileExists(AUDIO_PATH)) {
    throw new Error(
      `FFmpeg exited 0 but did not produce ${AUDIO_PATH}. Check the lavfi source.`
    );
  }

  log(
    `Wrote tests/fixtures/sample-audio.wav (3s 440Hz sine, ${formatBytes(fileSize(AUDIO_PATH))})`
  );
}

function main(): void {
  log('Generating test fixtures via FFmpeg...');

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    error('ERROR: ffmpeg not found on PATH.');
    error('Install FFmpeg: https://ffmpeg.org/download.html');
    error('On macOS: brew install ffmpeg');
    error('On Ubuntu: sudo apt-get install ffmpeg');
    error('On Windows: choco install ffmpeg');
    error('');
    error('Without FFmpeg, the render smoke test + media-ingestion integration');
    error('test will skip cleanly via test.skipIf(!ffmpegAvailable).');
    // Honest exit — don't fake the files.
    process.exit(1);
  }

  // Verify FFmpeg actually works (not just on PATH but invocable).
  try {
    execFileSync(ffmpegPath, ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`ERROR: ffmpeg found at ${ffmpegPath} but failed to run: ${msg}`);
    process.exit(1);
  }

  try {
    generateVideo(ffmpegPath);
    generateAudio(ffmpegPath);
    log('Done.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`ERROR: ${msg}`);
    process.exit(1);
  }
}

main();
