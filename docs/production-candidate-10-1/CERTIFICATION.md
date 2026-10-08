# VidiaForge v10.1 Certification

## Repository
- **Version**: v10.1
- **Date**: 2025-01-07
- **Lint**: 0 errors, 5 warnings (pre-existing)
- **Tests**: 134 pass, 8 skip (honest — require infra), 0 fail

## Blocker Matrix

| Blocker | Status | Evidence |
|---------|--------|----------|
| Transcription API authorization | PASS | `asset.userId` + `project.userId` + `asset.projectId === project.id` verified before AIJob creation |
| Worker asset ownership | PASS | `TRANSCRIPTION_ASSET_OWNERSHIP_MISMATCH` check |
| Worker project ownership | PASS | `TRANSCRIPTION_PROJECT_OWNERSHIP_MISMATCH` check |
| Asset/project consistency | PASS | `TRANSCRIPTION_ASSET_PROJECT_MISMATCH` check |
| Atomic AIJob claim | PASS | `updateMany({ where: { status: 'queued' } })` — 0 rows = already claimed |
| Attempt ownership | PASS | Re-verify `status === 'processing'` inside transaction |
| Late result protection | PASS | `TRANSCRIPTION_ATTEMPT_EXPIRED` if status changed |
| Deterministic transcription identity | PASS | SHA-256 of canonical JSON (projectId, assetId, provider, model, language, cues) |
| Authoritative configuration | PASS | Language/provider/model from AIJob DB record, not queue payload |
| Timeout protection | PASS | `Promise.race` + attempt re-verification prevents late finalization |
| Large proxy streaming | PASS | `createReadStream` + `uploadStream` (no `readFile`) |
| Large audio streaming | PASS | `createReadStream` + `uploadStream` (no `readFile`) |
| Obsolete FFmpeg test removed | PASS | Stale `command -v` skip test deleted |
| UsageRecord migration | PASS | Checks pg_constraint + pg_class/pg_index by name |
| Storage API contract | PASS | 0 `getObjectStream({` calls outside type defs |
| Shared FFmpeg resolver | PASS | `ffmpeg-service.ts` imports from `binary-resolver.ts` |

## Certification Table

| Category | Test | Result | Evidence |
|----------|------|--------|----------|
| TypeScript | typecheck | PASS | `tsc --noEmit --skipLibCheck` — 0 build-blocking errors |
| Lint | lint | PASS | `bun run lint` — 0 errors, 5 warnings |
| Storage | API contract | PASS | 0 object-style calls |
| Storage | streaming | PASS | proxy + audio use `uploadStream` |
| Storage | checkHealth | PASS | `accessible: true` on health endpoint |
| FFmpeg | resolver | PASS | `binary-resolver.ts` via `which` binary |
| FFmpeg | real render | PASS | Render smoke test: 3s MP4 produced |
| FFprobe | validation | PASS | Video + audio streams verified |
| Transcription | authorization | PASS | `TRANSCRIPTION_ASSET_PROJECT_MISMATCH` on invalid |
| Transcription | ownership | PASS | `TRANSCRIPTION_ASSET_OWNERSHIP_MISMATCH` on cross-user |
| Transcription | idempotency | PASS | SHA-256 identity replaces cue-count |
| Transcription | concurrency | PASS | Atomic `updateMany` claim |
| Transcription | timeout | PASS | `Promise.race` + attempt re-verification |
| Render | dedup | PASS | `renderIdentity` partial unique index |
| Render | cache recovery | PASS | Atomic invalidation + replacement |
| AI queue | unsupported | PASS | Throws `AI_JOB_KIND_UNSUPPORTED` |
| Security | cross-user | PASS | 404 for unauthorized access (no leak) |
| Unit | tests | PASS | 134 pass, 8 skip, 0 fail |
| E2E | FFmpeg render | PASS | Real video produced + FFprobe validated |
