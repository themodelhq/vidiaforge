# VidiaForge v13.1 — E2E Testing Guide

## Two E2E Modes

### Mode A — LOCAL FULL-STACK E2E

Validates the complete application stack in a production-like environment
without validating the cloud deployment topology.

**Does NOT require Netlify or Render.**

**Requires:**
- Docker (for PostgreSQL + Redis) OR native PostgreSQL/Redis
- FFmpeg + FFprobe installed locally
- Bun runtime

**Run:**
```bash
# Start infrastructure (PostgreSQL + Redis)
docker compose up -d postgres redis

# Run migrations
DATABASE_URL=postgresql://vidiaforge:vidiaforge@localhost:5432/vidiaforge bun run db:push

# Start the API
bun run dev

# Start the worker (separate terminal)
bun run worker:dev

# Run local certification
bun run test:certify:local

# Or run individual suites:
bun run test:aijob:concurrency    # AIJob lease/crash/recovery tests
bun run test:render               # FFmpeg render smoke test
bun run test:e2e:local             # Full media E2E (upload → render → download)
```

**Environment:**
```bash
# .env.test.example provides the template
DATABASE_URL=postgresql://vidiaforge:vidiaforge@localhost:5432/vidiaforge_test
REDIS_URL=redis://localhost:6379/1
STORAGE_PROVIDER=local
E2E_API_URL=http://localhost:3000
```

### Mode B — PRODUCTION E2E

Validates the actual Netlify → Render → PostgreSQL/Redis/Worker → S3/R2 deployment topology.

**Requires actual deployment.**

**Run:**
```bash
E2E_API_URL=https://vidiaforge-api.onrender.com \
E2E_BASE_URL=https://vidiaforge.netlify.app \
bun run test:e2e:production
```

**Never hardcode production URLs.** Always use environment variables.

## What Requires Deployment

### Does NOT require Netlify/Render:
- Typecheck
- Lint
- Unit tests
- Prisma migration tests
- PostgreSQL concurrency tests
- Redis/BullMQ worker tests
- FFmpeg/FFprobe tests
- Local media E2E (upload → render → download)
- AIJob crash/recovery tests
- Security tests

### DOES require actual deployment:
- Netlify → Render connectivity (CORS, cookies, HTTPS)
- Render PostgreSQL (production connection)
- Render Redis (production queue)
- Render Worker (production Docker)
- Production S3/R2
- Production environment variables
- Production browser E2E

## Certification Status Definitions

| Status | Meaning |
|--------|---------|
| PASS | Test executed and succeeded |
| FAIL | Test executed and failed |
| BLOCKED | Required infrastructure unavailable |
| SKIPPED | Developer/test-selection decision |
| STATIC PASS | Source inspection passed (NOT execution) |

A certification summary must NEVER convert SKIPPED or BLOCKED into PASS.

## AIJob Crash Recovery Test

The primary reliability certification test:

```
1. Create AIJob
2. Worker A claims attempt 1
3. Worker A heartbeat begins
4. Worker A is terminated
5. Heartbeat stops
6. Lease expires
7. Recovery requeues the job
8. Worker B claims attempt 2
9. Database confirms attempt = 2
10. Worker A cannot heartbeat (0 rows)
11. Worker A cannot fail (0 rows)
12. Worker A cannot complete (0 rows)
13. Worker A cannot modify project timeline
14. Worker B remains owner
15. Worker B completes successfully
16. Project changes are committed
17. AIJob becomes completed
18. Captions exist exactly once
19. No duplicate project mutation occurs
```

Run: `bun run test:aijob:concurrency`
