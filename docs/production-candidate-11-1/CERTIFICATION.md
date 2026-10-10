# VidiaForge v11.1 Certification

## Repository
- **Candidate**: v11.1
- **Timestamp**: 2026-10-07T10:50:00Z (generated dynamically)
- **Lint**: 0 errors, 5 warnings (pre-existing)
- **Tests**: 134 pass, 8 skip (honest — require infra), 0 fail

## Blocker Matrix

| Blocker | Status | Evidence |
|---------|--------|----------|
| Durable AIJob ownership (workerId/attemptId persisted) | PASS | `updateMany` claim writes `workerId`, `attemptId`, `attempt: { increment: 1 }` to DB |
| Atomic claim | PASS | `updateMany({ where: { status: 'queued' } })` — 0 rows = already claimed |
| Heartbeat with ownership verification | PASS | `updateMany({ where: { id, status: 'processing', workerId, attemptId } })` — 0 rows = ownership lost |
| Lease expiry + stale recovery | PASS | `updateMany({ where: { status: 'processing', heartbeatAt: { lt: cutoff } } })` — atomic, heartbeat-based |
| Attempt ownership at finalization | PASS | Transaction checks `currentJob.workerId === WORKER_ID AND currentJob.attemptId === attemptId` |
| Stale worker cannot finalize | PASS | `TRANSCRIPTION_STALE_ATTEMPT_REJECTED` if workerId/attemptId don't match |
| Stale worker cannot fail | PASS | Failure uses `updateMany` with `workerId + attemptId` WHERE clause |
| Heartbeat timer cleanup | PASS | `clearInterval(heartbeatTimer)` in `finally` block |
| Timeout timer cleanup | PASS | `clearTimeout(timeoutHandle)` in `finally` block |
| randomUUID imported correctly | PASS | `import { randomUUID } from 'crypto'` |
| Stable worker identity | PASS | `WORKER_ID` generated once at module load, reused for all jobs |
| AIJob stale recovery at startup | PASS | `updateMany` with `heartbeatAt < cutoff` (atomic, heartbeat-based, NOT queued) |
| Migration 0008 (additive) | PASS | `ALTER TABLE ADD COLUMN IF NOT EXISTS` — no data deleted |
| Storage API contract | PASS | 0 `getObjectStream({` calls outside type defs |
| Shared FFmpeg resolver | PASS | `ffmpeg-service.ts` imports from `binary-resolver.ts` |
| Transcription API authorization | PASS | `asset.userId` + `project.userId` + `asset.projectId === project.id` |
| Large media streaming | PASS | proxy + audio use `uploadStream` (no `readFile`) |
| Obsolete FFmpeg test removed | PASS | Stale `command -v` skip test deleted |
| Deterministic transcription identity | PASS | SHA-256 of canonical JSON (projectId, assetId, provider, model, language, cues) |

## AIJob Lifecycle

```
queued
   │
   ▼
processing (atomic claim: workerId, attemptId, attempt++, heartbeatAt)
   │
   ├── heartbeat → processing (ownership-guarded: workerId + attemptId)
   │
   ├── success → completed (ownership-guarded transaction)
   │
   ├── explicit failure → failed (ownership-guarded updateMany)
   │
   └── lease expiry → stale → failed (atomic recovery at next worker startup)
```

## Certification Table

| Category | Test | Type | Result | Evidence |
|----------|------|------|--------|----------|
| TypeScript | typecheck | UNIT | PASS | `tsc --noEmit --skipLibCheck` — 0 errors |
| Lint | lint | UNIT | PASS | `bun run lint` — 0 errors |
| Unit | All tests | UNIT | PASS | 134 pass, 8 skip, 0 fail |
| AIJob | Atomic claim | STATIC REVIEW | PASS | `updateMany` with `status: 'queued'` |
| AIJob | Heartbeat | STATIC REVIEW | PASS | `updateMany` with `workerId + attemptId` |
| AIJob | Stale recovery | STATIC REVIEW | PASS | `updateMany` with `heartbeatAt < cutoff` |
| AIJob | Attempt ownership | STATIC REVIEW | PASS | Transaction checks `workerId + attemptId` |
| AIJob | Stale worker rejection | STATIC REVIEW | PASS | `TRANSCRIPTION_STALE_ATTEMPT_REJECTED` |
| Transcription | Authorization | STATIC REVIEW | PASS | `asset.userId + project.userId + asset.projectId` |
| Transcription | Identity | STATIC REVIEW | PASS | SHA-256 canonical JSON |
| Transcription | API authorization | STATIC REVIEW | PASS | 404 for unauthorized |
| Storage | API contract | STATIC REVIEW | PASS | 0 object-style calls |
| FFmpeg | Real render | E2E | PASS | Render smoke test: real MP4 produced |
| FFprobe | Validation | E2E | PASS | Video + audio streams verified |
| PostgreSQL | Real migration | INTEGRATION | BLOCKED | No real PostgreSQL in sandbox |
| Redis | Queue | INTEGRATION | BLOCKED | No real Redis in sandbox |
| S3/R2 | Storage | INTEGRATION | BLOCKED | No real S3 credentials |
| E2E | Full pipeline | E2E | BLOCKED | Requires real infrastructure |
