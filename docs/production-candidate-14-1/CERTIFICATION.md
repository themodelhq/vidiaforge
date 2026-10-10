# VidiaForge v14.1 — Certification

## Repository
- **Candidate**: v14.1
- **Timestamp**: Generated dynamically at certification time
- **Lint**: 0 errors, 5 warnings (pre-existing)
- **Unit Tests**: 142 pass, 8 skip, 0 fail
- **AIJob Concurrency**: 10 tests (see results below)

## P0 Fix: NULL Heartbeat Recovery

**Problem**: The old logic used `heartbeatAt IS NULL` as a blanket stale condition. A recently started AIJob with `processingStartedAt = recent` and `heartbeatAt = NULL` would be incorrectly recovered.

**Fix**: The stale condition is now:
```text
heartbeatAt < staleCutoff
OR (heartbeatAt IS NULL AND processingStartedAt < staleCutoff)
```

This uses `processingStartedAt` as the fallback lease anchor for NULL heartbeat jobs.

## Local Certification Matrix

| Category | Test | Result | Evidence |
|----------|------|--------|----------|
| Build | TypeScript | PASS | `bun run typecheck` — 0 errors |
| Build | Lint | PASS | `bun run lint` — 0 errors |
| Tests | Unit | PASS | 142 pass, 8 skip, 0 fail |
| AIJob | Concurrent claim (2 workers, Promise.all) | PASS | Exactly 1 winner |
| AIJob | Concurrent claim (5 workers, Promise.all) | PASS | Exactly 1 winner |
| AIJob | Attempt identity | PASS | Correct fields persisted |
| AIJob | Heartbeat ownership | PASS | Non-owner → 0 rows |
| AIJob | Crash recovery lifecycle | PASS | Stale → re-queue → new claim → stale rejected |
| AIJob | Concurrent recovery (Promise.all) | PASS | Exactly 1 recovery succeeds |
| AIJob | NULL heartbeat + OLD startedAt → RECOVER | PASS | 1 row recovered |
| AIJob | NULL heartbeat + RECENT startedAt → NOT recovered | PASS | 0 rows, job stays processing |
| AIJob | Old heartbeat → RECOVER | PASS | 1 row recovered |
| AIJob | Old startedAt + recent heartbeat → NOT recovered | PASS | 0 rows, job stays processing |
| FFmpeg | Real render | PASS | Render smoke test: 3s MP4 produced |
| FFprobe | Validation | PASS | Video + audio streams verified |
| PostgreSQL | Real connection | BLOCKED | No real PostgreSQL in sandbox |
| Redis | Queue | BLOCKED | No real Redis in sandbox |
| S3/R2 | Storage | BLOCKED | No real S3 credentials |
| Transcription | Real provider | BLOCKED | No transcription API key |

## Production Certification Matrix

| Category | Test | Result |
|----------|------|--------|
| Netlify | Frontend loads | NOT RUN |
| Netlify | Auth | NOT RUN |
| Render | API health | NOT RUN |
| Render | PostgreSQL | NOT RUN |
| Render | Redis | NOT RUN |
| Render | Worker | NOT RUN |
| Storage | S3/R2 | NOT RUN |
| Media | Upload | NOT RUN |
| Render | FFmpeg | NOT RUN |
| FFprobe | Output validation | NOT RUN |
| AI | Transcription | NOT RUN |
| Security | Cross-user | NOT RUN |

## Certification Status

```
LOCAL CERTIFICATION — PASS (with BLOCKED items for infra-dependent tests)
PRODUCTION CERTIFICATION — NOT RUN
OVERALL PRODUCTION STATUS — PENDING
```

## Note on SQLite vs PostgreSQL

The Prisma schema specifies `provider = "postgresql"`. Certification evidence
must state PostgreSQL when PostgreSQL is used. If PostgreSQL is unavailable,
the result is BLOCKED — not PASS. SQLite is used in the sandbox for development
only and is NEVER substituted for PostgreSQL-specific concurrency certification.
