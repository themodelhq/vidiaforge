# VidiaForge v15.1 — Certification

## Repository
- **Candidate**: v15.1
- **Timestamp**: Generated dynamically at certification time
- **Schema Provider**: PostgreSQL (never SQLite for concurrency certification)

## Local Certification Matrix

| Category | Test | Type | Result | Evidence |
|----------|------|------|--------|----------|
| Build | TypeScript | STATIC | PASS | `bun run typecheck` — 0 errors |
| Build | Lint | STATIC | PASS | `bun run lint` — 0 errors |
| Tests | Unit | UNIT | PASS | 144 pass, 8 skip, 0 fail |
| AIJob | DB concurrent claim (2 workers, Promise.all) | DB INTEGRATION | PASS | Exactly 1 winner |
| AIJob | DB concurrent claim (5 workers, Promise.all) | DB INTEGRATION | PASS | Exactly 1 winner |
| AIJob | Heartbeat ownership | DB INTEGRATION | PASS | Non-owner → 0 rows |
| AIJob | Crash recovery lifecycle | DB INTEGRATION | PASS | Stale → re-queue → stale rejected |
| AIJob | Concurrent recovery (Promise.all) | DB INTEGRATION | PASS | Exactly 1 recovery |
| AIJob | NULL heartbeat + OLD → RECOVER | DB INTEGRATION | PASS | 1 row |
| AIJob | NULL heartbeat + RECENT → NOT recovered | DB INTEGRATION | PASS | 0 rows |
| AIJob | Worker-process crash/recovery | WORKER INTEGRATION | BLOCKED | Requires PostgreSQL + Redis |
| FFmpeg | Real render | E2E | PASS | 3s MP4 produced + FFprobe validated |
| FFprobe | Validation | E2E | PASS | Video + audio streams verified |
| PostgreSQL | Real connection | INTEGRATION | BLOCKED | No real PostgreSQL in sandbox |
| Redis | Queue | INTEGRATION | BLOCKED | No real Redis in sandbox |
| S3/R2 | Storage | INTEGRATION | BLOCKED | No real S3 credentials |

## Production Certification Matrix

| Category | Test | Result |
|----------|------|--------|
| Netlify | Frontend | NOT RUN |
| Render | API health | NOT RUN |
| Render | Worker | NOT RUN |
| Storage | S3/R2 | NOT RUN |
| Full E2E | Upload → Download | NOT RUN |
| Network | Private networking | STATIC PASS — 0.0.0.0/0 removed from render.yaml |

## Worker Crash/Recovery Evidence

```
Test: tests/worker-integration/crash-recovery.test.ts
Status: BLOCKED (requires PostgreSQL + Redis + worker process)
```

When infrastructure is available, this test:
1. Creates a test AIJob
2. Starts real Worker A process (via `bun run mini-services/worker/src/index.ts`)
3. Verifies Worker A claims attempt 1 in PostgreSQL
4. Verifies heartbeat activity
5. Kills Worker A via SIGKILL (real crash)
6. Waits for lease expiry
7. Runs atomic stale recovery
8. Starts real Worker B process
9. Verifies Worker B claims attempt 2
10. Tests stale Worker A heartbeat → 0 rows
11. Tests stale Worker A completion → 0 rows
12. Tests stale Worker A failure → 0 rows
13. Verifies Worker B remains authoritative

## Certification Status

```
LOCAL CERTIFICATION — BLOCKED (PostgreSQL + Redis required for worker crash test)
PRODUCTION CERTIFICATION — NOT RUN
OVERALL PRODUCTION STATUS — PENDING
```

## Network Hardening

- **PostgreSQL**: `0.0.0.0/0` ipAllowList REMOVED — private/internal networking only
- **Redis**: `0.0.0.0/0` ipAllowList REMOVED — private/internal networking only
- **Render services**: Connect via internal `fromDatabase` connection strings
