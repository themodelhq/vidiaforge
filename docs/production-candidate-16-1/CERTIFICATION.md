# VidiaForge v16.1 — Certification

## Repository
- **Candidate**: v16.1
- **Timestamp**: Generated dynamically at certification time
- **Schema Provider**: PostgreSQL (never SQLite for concurrency certification)

## v16.1 Key Improvement: Real BullMQ Job Flow

The crash/recovery test now exercises the REAL production path:
```
BullMQ Queue → Redis → Worker A process → AIJob claim → heartbeat →
SIGKILL → lease expiry → production recovery → Worker B → attempt 2 →
stale Worker A rejection → Worker B completion
```

The test uses:
- `enqueue()` from `src/lib/queue.ts` (production queue abstraction)
- `WorkerHarness` from `tests/helpers/worker-process.ts` (real `child_process.spawn`)
- Real SIGKILL (not graceful shutdown)
- Real lease expiry (no manual DB timestamp manipulation)
- Real production recovery query (same SQL as `recoverStaleJobs()`)

## Local Certification Matrix

| Category | Test | Type | Result | Evidence |
|----------|------|------|--------|----------|
| Build | TypeScript | STATIC | PASS | 0 errors |
| Build | Lint | STATIC | PASS | 0 errors |
| Tests | Unit | UNIT | PASS | 145 pass, 8 skip, 0 fail |
| AIJob | DB concurrent claim (Promise.all) | DB INTEGRATION | PASS | 10 tests pass |
| AIJob | Worker crash/recovery | WORKER INTEGRATION | BLOCKED | Requires PostgreSQL + Redis |
| AIJob | Multi-worker competition (5 workers) | WORKER INTEGRATION | BLOCKED | Requires PostgreSQL + Redis |
| FFmpeg | Real render | E2E | PASS | 3s MP4 + FFprobe validated |
| FFprobe | Validation | E2E | PASS | Video + audio streams |
| PostgreSQL | Real connection (SELECT 1) | INTEGRATION | BLOCKED | No real PostgreSQL in sandbox |
| Redis | Real connection (PING) | INTEGRATION | BLOCKED | No real Redis in sandbox |
| S3/R2 | Storage | INTEGRATION | BLOCKED | No real S3 credentials |
| Local E2E | Upload → Download | E2E | BLOCKED | Requires full stack |
| Network | Private networking | STATIC | PASS | 0.0.0.0/0 removed |
| Production E2E | Full pipeline | PRODUCTION | NOT RUN | |

## Worker Crash/Recovery Evidence

When infrastructure is available, the test generates:
```
artifacts/certification/aijob-crash-recovery.json
```

Containing:
- BullMQ job ID
- Worker A PID, workerId, attemptId, heartbeats
- SIGKILL timestamp
- Recovery timestamp + rows affected
- Worker B PID, workerId, attemptId
- Late operation rejection results (heartbeat, completion, failure)
- Final AIJob status

## Certification Status

```
LOCAL CERTIFICATION — BLOCKED (PostgreSQL + Redis required for worker crash test)
PRODUCTION CERTIFICATION — NOT RUN
OVERALL PRODUCTION STATUS — PENDING
```
