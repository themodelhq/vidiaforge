# VidiaForge v9.1 — Blocker Remediation

## Fixed

### BLOCKER 1 — Storage API mismatch (§5-9)
**Problem**: `media-ingestion.ts` and related processors called `storage.getObjectStream({ key: asset.storagePath })` while the interface expects `getObjectStream(key: string, range?)`.

**Fix**: Replaced all 3 object-style calls in `media-ingestion.ts` with `storage.getObjectStream(asset.storagePath)`. Performed a repository-wide audit — zero remaining `getObjectStream({` calls outside of type definitions.

**Evidence**: `grep -rn "getObjectStream({" src/ mini-services/ | grep -v types.ts` → 0 results

### BLOCKER 2 — Duplicate/broken FFmpeg resolver (§10-16)
**Problem**: `ffmpeg-service.ts` contained a `which()` function using `execFile('command', ['-v', bin])`. `command` is a shell builtin and `execFile` doesn't use a shell, so the lookup always failed.

**Fix**: Removed the `which()` function + `BinaryCheck` type + `ffprobeCheck`/`ffmpegCheck` caches. Replaced with `import { resolveFfmpeg, resolveFfprobe } from './binary-resolver'` — the shared resolver that handles env vars → npm packages → system PATH via `which` binary → container default paths. All FFmpeg/FFprobe discovery now goes through ONE resolver.

**Evidence**: `grep -n "execFile.*command" src/lib/media/ffmpeg-service.ts` → 0 results (only in comments documenting the fix)

### BLOCKER 3 — Transcription false completion (§17-22)
**Problem**: The transcription transaction used `if (projectId) { if (project) { ... } }` around caption application. If the project didn't exist, the job was still marked `completed` without applying any captions.

**Fix**: Project existence is now a HARD REQUIREMENT — `throw new Error('TRANSCRIPTION_PROJECT_NOT_FOUND')` if project is null. Ownership is verified: `project.userId !== aiJob.userId` throws `TRANSCRIPTION_PROJECT_OWNERSHIP_MISMATCH`. The `db.$transaction()` now applies captions FIRST, then marks AIJob completed — both in the same atomic transaction.

**Evidence**: `grep -n "TRANSCRIPTION_PROJECT_NOT_FOUND" mini-services/worker/src/processors/transcription.ts` → 2 results (null check + not-found check)

### BLOCKER 4 — Count-based transcription idempotency (§23-29)
**Problem**: Existing caption detection used `c.caption?.cues?.length === cues.length`. Two completely different transcripts with the same cue count would incorrectly match.

**Fix**: Created `src/lib/transcription/transcription-identity.ts` with `computeTranscriptionIdentity()` — SHA-256 of canonical JSON containing: projectId, assetId, provider, providerModel, language, and the actual transcript cues (start, end, text). The identity is stored in the caption clip's `caption.transcriptionIdentity` field. Retries check for this identity, not cue count.

**Evidence**: `grep -n "transcriptionIdentity" mini-services/worker/src/processors/transcription.ts` → 5 results (compute, store, check, reuse, AIJob output)

## Remaining Issues

Only genuine infrastructure-dependent items remain:
- Full E2E pipeline (upload → render → download) requires real PostgreSQL + Redis + FFmpeg + S3
- Docker worker build requires Docker runtime
- Netlify/Render deployment requires real accounts
