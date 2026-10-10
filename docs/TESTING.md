# VidiaForge — Testing Strategy

> **Scope.** This document explains the test types, what they cover,
> when they run, and how to invoke them.
>
> **Test runner.** VidiaForge uses **`bun:test`** (Bun's built-in test
> runner). No new dependencies are installed — `bun test` is built into
> the Bun runtime. The `bun-types` devDependency provides TypeScript
> types for `bun:test`.
>
> **Honest tests.** Tests that require unavailable infrastructure
> (Redis, PostgreSQL, FFmpeg) use `test.skipIf(...)` to skip cleanly
> when their infrastructure is missing. They NEVER fake a pass.

---

## 1. Test pyramid

VidiaForge's test suite follows the standard pyramid:

```
                    ┌─────────────────┐
                    │   E2E tests      │  ← tests/e2e/
                    │   (1 skeleton)   │     skips if no E2E_API_URL
                    └─────────────────┘
                  ┌─────────────────────┐
                  │  Integration tests  │  ← tests/integration/
                  │  (2 files)          │     skip if no Redis / FFmpeg
                  └─────────────────────┘
                ┌──────────────────────────┐
                │  Render smoke test       │  ← tests/render-smoke.test.ts
                │  (deterministic)         │     skips if no FFmpeg
                └──────────────────────────┘
              ┌──────────────────────────────┐
              │  Unit tests                  │  ← tests/unit/
              │  (4 files, no infra needed) │     always run
              └──────────────────────────────┘
```

### 1.1 Test counts

| Layer | Files | Tests | Infra required | Skip behavior |
|---|---|---|---|---|
| Unit | 4 | ~25 | None | Always run |
| Render smoke | 1 | 1 (multi-step) | FFmpeg | `test.skipIf(!ffmpegAvailable)` |
| Integration | 2 | 2-4 | Redis + PostgreSQL + FFmpeg | `test.skipIf(!process.env.REDIS_URL)` / `test.skipIf(!ffmpegAvailable)` |
| E2E | 1 | 1 (multi-step) | Deployed env | `test.skipIf(!process.env.E2E_API_URL)` |

---

## 2. Unit tests (`tests/unit/`)

Unit tests are pure-function tests with no external dependencies. They
run instantly and cover the core logic that the render pipeline + UI
depend on.

### 2.1 `tests/unit/timeline.test.ts`

Tests for `src/lib/timeline.ts` pure functions:

| Test | Asserts |
|---|---|
| `createClip produces correct defaults` | `createClip({ trackId, kind })` returns a clip with `sourceStart=0`, `sourceEnd=5`, `timelineStart=0`, `duration=5`, `speed=1`, `enabled=true`, sensible defaults for `transform`, `crop`, `color`, `audio` |
| `splitClip produces two clips with correct durations + sourceStart/sourceEnd` | Splitting a 5s clip at t=2s produces a 2s clip (sourceStart=0, sourceEnd=2) + a 3s clip (sourceStart=2, sourceEnd=5) |
| `trimClip adjusts duration correctly` | Trimming a 5s clip to start at t=1s, end at t=4s produces a 3s clip |
| `moveClip respects timeline bounds` | Moving a clip with duration=5s to timelineStart=10s places it at [10, 15] |
| `computeDuration returns max clip end` | For clips ending at 5s, 8s, 3s → returns 8s |
| `formatTimecode formats correctly (HH:MM:SS:FF + seconds)` | `formatTimecode(3661.5, 30)` → `"01:01:01:15"`; `formatTimecode(3661.5, 30, 'seconds')` → `"3661.500"` |
| `snap snaps to nearest target within threshold` | `snap(5.1, [5, 10], 0.25)` → `{ value: 5, snapped: true }`; `snap(5.5, [5, 10], 0.25)` → `{ value: 5.5, snapped: false }` |

**Import path.** `import { createClip, ... } from '../../src/lib/timeline'`.

### 2.2 `tests/unit/project-schema.test.ts`

Tests for `src/lib/timeline.ts` schema versioning:

| Test | Asserts |
|---|---|
| `emptyProjectDocument has schemaVersion: 1` | `emptyProjectDocument('id', 'name').schemaVersion === 1` |
| `Project document round-trips through JSON.stringify/parse` | `JSON.parse(JSON.stringify(doc))` deeply equals `doc` |
| `Schema version is preserved on save` | After a simulated save (JSON round-trip), `schemaVersion` is still 1 |

**Import path.** `import { emptyProjectDocument } from '../../src/lib/timeline'`.

### 2.3 `tests/unit/render-filter-graph.test.ts`

Tests for `src/lib/render/filter-graph.ts` `buildFilterGraph()`:

| Test | Asserts |
|---|---|
| `Empty project produces empty graph (with black background)` | Empty project → graph with 1 SourceNode (`__black__`) + 1 OutputNode, `duration=0` |
| `Single video clip produces SourceNode + TrimNode + OutputNode` | One video clip → graph contains at least 1 SourceNode + 1 OutputNode |
| `Multiple clips produce composite nodes` | Two video clips → graph contains at least 2 SourceNodes + 1 TransitionNode + 1 OutputNode |
| `Text overlay adds a TextNode` | One text clip → graph contains 1 TextNode |
| `Transition adds a TransitionNode` | Two video clips with a transition → graph contains 1 TransitionNode |

**Import path.** `import { buildFilterGraph } from '../../src/lib/render/filter-graph'`.

### 2.4 `tests/unit/storage.test.ts`

Tests for `src/lib/storage/local-provider.ts` `LocalStorageProvider`:

| Test | Asserts |
|---|---|
| `putObject writes a file to a temp dir` | After `putObject({ key, body: Buffer.from('hello') })`, `fs.readFile` returns the bytes |
| `objectExists returns true after put` | After `putObject`, `objectExists(key)` returns `true` |
| `getObject returns the same bytes` | `getObject({ key })` returns a stream that drains to the same bytes that were put |
| `deleteObject removes the file` | After `deleteObject(key)`, `objectExists(key)` returns `false` |
| `uploadStream streams without buffering (file exists + correct size)` | After `uploadStream(key, Readable.from('hello world'))`, `fs.stat(key).size === 11` |

**Test isolation.** Uses Node's `os.tmpdir()` + `mkdtemp()` for a fresh
temp dir per test. Sets `UPLOAD_DIR` env var to the temp dir so the
provider writes there.

**Import path.** `import { LocalStorageProvider } from '../../src/lib/storage/local-provider'`.

---

## 3. Integration tests (`tests/integration/`)

Integration tests exercise the full worker + API + DB + Redis stack.
They require real infrastructure and `test.skipIf(...)` out cleanly when
that infrastructure is unavailable.

### 3.1 `tests/integration/render-job.test.ts`

| Test | Infra | Skip condition |
|---|---|---|
| `POST /api/render returns 503 with RENDER_QUEUE_NOT_CONFIGURED when no REDIS_URL` | None | Always runs (asserts the no-Redis path) |
| `POST /api/render queues a real render job when REDIS_URL is set` | Redis + PG + worker | `test.skipIf(!process.env.REDIS_URL)` |

The second test, when run:

1. Starts a test API server (or uses an existing one).
2. Registers a test user + creates a test project.
3. Calls `POST /api/render` with the project ID.
4. Verifies the response is `201 { job, queued: true, queueJobId: ... }`.
5. Polls `GET /api/render/[id]` until `status === "completed"` (with a
   timeout — fails the test if the render takes too long).
6. Verifies `outputUrl` is set + the output exists in storage.

### 3.2 `tests/integration/media-ingestion.test.ts`

| Test | Infra | Skip condition |
|---|---|---|
| `media-ingestion processor flips status to ready + creates thumbnail` | FFmpeg + FFprobe + PG + storage | `test.skipIf(!ffmpegAvailable)` |

The test, when run:

1. Generates a fixture via `tests/fixtures/generate.ts` (if not already
   present).
2. Creates a `MediaAsset` row with `status='uploading'` pointing at the
   fixture.
3. Calls the `processMediaIngestion` processor directly (with a fake
   BullMQ job object containing `{ data: { assetId } }`).
4. Verifies the asset's `status` flipped to `'ready'`.
5. Verifies `thumbnailUrl` is set + the thumbnail object exists in storage.
6. Verifies `duration`, `width`, `height`, `fps`, `codec` are populated.

FFmpeg detection uses `which ffmpeg` (the same pattern as the
`MediaBinaryResolver`).

---

## 4. E2E tests (`tests/e2e/`)

### 4.1 `tests/e2e/upload-render-download.spec.ts`

| Test | Infra | Skip condition |
|---|---|---|
| `full upload → render → download flow` | Deployed env (E2E_API_URL) | `test.skipIf(!process.env.E2E_API_URL)` |

The test, when run against a deployed environment:

1. Register a fresh test user via `POST /api/auth/register`.
2. Create a test project via `POST /api/projects`.
3. Upload a fixture video via `POST /api/assets/upload`.
4. Poll `GET /api/assets` until the asset's `status === 'ready'`
   (media ingestion completed).
5. Patch the project's `timelineData` to add a clip referencing the
   asset.
6. Call `POST /api/render` with the project ID + a preset
   (`youtube-1080p`).
7. Poll `GET /api/render/[id]` until `status === 'completed'`
   (timeout: 5 minutes).
8. Download the output via `outputUrl`.
9. Run `ffprobe` on the downloaded output.
10. Verify: file exists, size > 0, duration ≈ source duration,
    resolution matches the preset, codec is h264, audio stream present.

This is a SKELETON — the full implementation requires the deployed
environment to be reachable. The skeleton documents the flow + skips
cleanly in CI.

---

## 5. Render smoke test

### 5.1 `tests/render-smoke.test.ts`

| Test | Infra | Skip condition |
|---|---|---|
| `deterministic render of 3s test fixture` | FFmpeg + FFprobe | `test.skipIf(!ffmpegAvailable)` |

The test, when run:

1. **Detect FFmpeg** via `which ffmpeg` + `which ffprobe` (sets
   `ffmpegAvailable = true` if both are found).
2. **Generate fixtures** (if not already present) by running
   `tests/fixtures/generate.ts`:
   - `tests/fixtures/sample-video.mp4` — 3s, 640×480, 30fps, H.264.
   - `tests/fixtures/sample-audio.wav` — 3s, 440Hz sine wave, PCM 16-bit.
3. **Load the sample project** from `tests/fixtures/sample-project.json`.
4. **Build the filter graph** from the project via `buildFilterGraph()`.
5. **Render** via `FFmpegRenderService.render()` to a temp output file
   in `os.tmpdir()`.
6. **Run `ffprobe`** on the output.
7. **Verify**:
   - File exists on disk.
   - File size > 0.
   - Duration ≈ 3s (within 10%).
   - Resolution = 640×480 (within 1px).
   - Video codec = `h264`.
   - Audio stream exists.

The test is **deterministic** — same fixtures + same FFmpeg version
produce the same output. The fixtures are generated by FFmpeg's
`testsrc` + `sine` lavfi sources, which are deterministic across FFmpeg
versions.

If FFmpeg is not available, the test is **skipped** (not failed) with a
clear message: "FFmpeg not available — skipping render smoke test.
Install FFmpeg (https://ffmpeg.org/download.html) to enable this test."

---

## 6. Production smoke test commands

After deploying VidiaForge to Render + Netlify (see
`docs/DEPLOYMENT_NETLIFY_RENDER.md`), run these smoke tests against
the deployed environment:

### 6.1 API health

```bash
curl https://vidiaforge-api.onrender.com/api/health
# Expect: 200 JSON { status: "ok", db: "connected" }
```

### 6.2 Worker health (via Render shell)

```bash
render shell vidiaforge-worker
curl http://localhost:3001/health
# Expect: 200 JSON { status: "ok", workers: [...], time: "..." }
```

### 6.3 Auth flow

```bash
# Register
curl -X POST https://vidiaforge-api.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.com","password":"password123","name":"Smoke"}' \
  -c /tmp/cookies.txt

# Verify session
curl https://vidiaforge-api.onrender.com/api/auth/me \
  -b /tmp/cookies.txt
# Expect: 200 JSON { id, email: "smoke@test.com", ... }
```

### 6.4 Project CRUD

```bash
# Create
curl -X POST https://vidiaforge-api.onrender.com/api/projects \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"name":"Smoke test project"}'

# List
curl https://vidiaforge-api.onrender.com/api/projects \
  -b /tmp/cookies.txt
# Expect: 200 JSON { projects: [ { id, name: "Smoke test project", ... } ] }
```

### 6.5 Upload + ingestion

```bash
# Upload (use a real video file)
curl -X POST https://vidiaforge-api.onrender.com/api/assets/upload \
  -b /tmp/cookies.txt \
  -F "file=@sample.mp4" \
  -F "projectId=<project-id>"

# Poll until status === 'ready'
curl https://vidiaforge-api.onrender.com/api/assets \
  -b /tmp/cookies.txt
```

### 6.6 Render

```bash
# Queue
curl -X POST https://vidiaforge-api.onrender.com/api/render \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"projectId":"<project-id>","preset":"youtube-1080p"}'

# Poll until status === 'completed'
curl https://vidiaforge-api.onrender.com/api/render/<job-id> \
  -b /tmp/cookies.txt
```

### 6.7 Full E2E test against deployed env

```bash
E2E_API_URL=https://vidiaforge-api.onrender.com bun run test:e2e
```

---

## 7. How to run tests

### 7.1 All tests

```bash
cd /home/z/my-project
bun test
```

Runs every `*.test.ts` file in the repo. Tests with `test.skipIf(...)`
skip cleanly when their infrastructure is missing — they NEVER fail a CI
run on a sandbox without FFmpeg/Redis/PG.

### 7.2 Unit tests only (no infrastructure required)

```bash
bun run test:unit
# Equivalent to: bun test tests/unit/
```

Always runs. ~25 tests, < 1s total runtime.

### 7.3 Integration tests

```bash
bun run test:integration
# Equivalent to: bun test tests/integration/
```

Skips cleanly if no Redis / FFmpeg. To actually run them:

```bash
# Start Redis + PostgreSQL via Docker
docker run -d --name vf-redis -p 6379:6379 redis:7-alpine
docker run -d --name vf-pg -e POSTGRES_DB=vidiaforge -e POSTGRES_USER=vf -e POSTGRES_PASSWORD=vf -p 5432:5432 postgres:15-alpine

# Set env vars
export DATABASE_URL="postgresql://vf:vf@localhost:5432/vidiaforge"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET=$(openssl rand -hex 32)
export SESSION_SECRET=$(openssl rand -hex 32)

# Apply migrations
bunx prisma migrate deploy

# Run integration tests
bun run test:integration
```

### 7.4 E2E tests

```bash
E2E_API_URL=https://vidiaforge-api.onrender.com bun run test:e2e
```

Skips cleanly if `E2E_API_URL` is unset.

### 7.5 Render smoke test

```bash
# One-time: generate fixtures (requires FFmpeg)
bun run fixtures:generate

# Run the smoke test
bun run test:render
```

Skips cleanly if FFmpeg is not available.

---

## 8. Test fixtures location

All test fixtures live in `tests/fixtures/`:

| File | Purpose |
|---|---|
| `tests/fixtures/README.md` | Explains fixture generation |
| `tests/fixtures/generate.ts` | Bun script that uses FFmpeg to generate `sample-video.mp4` + `sample-audio.wav` |
| `tests/fixtures/sample-video.mp4` | Generated 3s 640×480 30fps H.264 video with testsrc + sine audio |
| `tests/fixtures/sample-audio.wav` | Generated 3s 440Hz sine wave PCM 16-bit audio |
| `tests/fixtures/sample-project.json` | Hand-written `ProjectDocument` fixture referencing the above |

### 8.1 Fixture generation

The fixture generator (`tests/fixtures/generate.ts`) is HONEST: if
FFmpeg is not available, it prints a clear message and exits 1 — it
does NOT fake the files.

```bash
$ bun tests/fixtures/generate.ts
[fixtures] Generating test fixtures via FFmpeg...
[fixtures] Wrote tests/fixtures/sample-video.mp4 (3s 640x480 30fps H.264)
[fixtures] Wrote tests/fixtures/sample-audio.wav (3s 440Hz sine)
[fixtures] Done.
```

If FFmpeg is missing:

```bash
$ bun tests/fixtures/generate.ts
[fixtures] ERROR: ffmpeg not found on PATH.
[fixtures] Install FFmpeg: https://ffmpeg.org/download.html
[fixtures] On macOS: brew install ffmpeg
[fixtures] On Ubuntu: sudo apt-get install ffmpeg
error: "ffmpeg not found. Install FFmpeg to generate test fixtures."
```

### 8.2 Why fixtures are not committed

The generated `sample-video.mp4` + `sample-audio.wav` are NOT committed
to git (they're binary + can be regenerated deterministically). The
generator script IS committed. CI pipelines should run
`bun run fixtures:generate` as a pre-test step (the `test:render` script
does this automatically).

### 8.3 Sample project fixture

`tests/fixtures/sample-project.json` is a hand-written `ProjectDocument`
JSON fixture used by the render smoke test. It references
`sample-video.mp4` + `sample-audio.wav` via the `assets` array, with
a video clip on the video track, an audio clip on the audio track, a
text clip overlay, and a fade transition between two video segments.

The render smoke test loads this fixture, builds a filter graph from
it, runs `FFmpegRenderService.render()`, and verifies the output.

---

## 9. CI integration

For a CI pipeline (GitHub Actions, GitLab CI, etc.):

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: 1.x
      - run: bun install --frozen-lockfile
      # Unit tests — always run
      - run: bun run test:unit
      # Generate fixtures (requires FFmpeg)
      - name: Install FFmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: bun run fixtures:generate
      # Render smoke test (requires FFmpeg — installed above)
      - run: bun run test:render
      # Integration tests (requires Redis + PostgreSQL)
      - uses: supercharge/redis-github-action@1.7.0
      - uses: harmon758/postgresql-action@v1
        with:
          postgresql version: '15'
          postgresql db: vidiaforge
          postgresql user: vf
          postgresql password: vf
      - run: bunx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://vf:vf@localhost:5432/vidiaforge
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-at-least-32-chars-long-xxx
          SESSION_SECRET: test-secret-at-least-32-chars-long-yyy
      - run: bun run test:integration
        env:
          DATABASE_URL: postgresql://vf:vf@localhost:5432/vidiaforge
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-at-least-32-chars-long-xxx
          SESSION_SECRET: test-secret-at-least-32-chars-long-yyy
```

The unit tests run on every push. The render smoke test runs after
FFmpeg is installed. The integration tests run after Redis + PostgreSQL
services are started.

---

## 10. Test discipline

### 10.1 HONEST tests

- NEVER fake a pass. If a test requires infrastructure that's missing,
  use `test.skipIf(...)` to skip it cleanly.
- NEVER mock the actual FFmpeg child process — the render smoke test
  runs real FFmpeg against real fixtures.
- NEVER mock Prisma — the integration tests use a real PostgreSQL
  instance.

### 10.2 Deterministic tests

- The render smoke test uses FFmpeg's `testsrc` + `sine` lavfi sources
  which are deterministic across FFmpeg versions.
- Unit tests use no I/O — pure functions only.
- Integration tests use fresh test users + projects per run (cleaned
  up via a `try/finally` block).

### 10.3 Fast tests

- Unit tests run in < 1s.
- The render smoke test runs in ~5s (3s render + 2s ffprobe).
- Integration tests run in ~10-30s (depending on FFmpeg + DB speed).
- E2E tests run in ~1-5 min (depending on the deployed environment's
  response time).

### 10.4 Independent tests

- Each test cleans up its own state (temp dirs, test users, test projects).
- Tests do NOT depend on execution order.
- Tests do NOT share state across files.

---

## 11. Test file index

| Path | Layer | Tests | Infra | Skip condition |
|---|---|---|---|---|
| `tests/unit/timeline.test.ts` | unit | ~7 | none | never skips |
| `tests/unit/project-schema.test.ts` | unit | 3 | none | never skips |
| `tests/unit/render-filter-graph.test.ts` | unit | 5 | none | never skips |
| `tests/unit/storage.test.ts` | unit | 5 | none (uses os.tmpdir) | never skips |
| `tests/integration/render-job.test.ts` | integration | 2 | Redis + PG | `test.skipIf(!process.env.REDIS_URL)` for the second test |
| `tests/integration/media-ingestion.test.ts` | integration | 1 | FFmpeg + PG | `test.skipIf(!ffmpegAvailable)` |
| `tests/e2e/upload-render-download.spec.ts` | e2e | 1 (skeleton) | deployed env | `test.skipIf(!process.env.E2E_API_URL)` |
| `tests/render-smoke.test.ts` | smoke | 1 | FFmpeg | `test.skipIf(!ffmpegAvailable)` |

---

## 12. Test runner config

### 12.1 `package.json` scripts

```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test tests/unit/",
    "test:integration": "bun test tests/integration/",
    "test:e2e": "bun test tests/e2e/",
    "test:render": "bun test tests/render-smoke.test.ts",
    "fixtures:generate": "bun tests/fixtures/generate.ts"
  }
}
```

### 12.2 `tests/tsconfig.json`

Extends the root `tsconfig.json` with path aliases for test imports.
The root tsconfig already has `"@/*": ["./src/*"]` mapped, so tests
can use either `@/lib/timeline` (alias) OR `../../src/lib/timeline`
(relative). The test files use relative paths to avoid depending on
the root tsconfig's `paths` resolution at test time (Bun's test runner
resolves relative paths directly).

### 12.3 `eslint.config.mjs`

The ESLint config ignores `node_modules/**`, `.next/**`, `out/**`,
`build/**`, `next-env.d.ts`, `examples/**`, and `skills`. It does NOT
ignore `tests/` — test files are linted like any other TypeScript file.
