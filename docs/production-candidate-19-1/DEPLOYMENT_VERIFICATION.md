# VidiaForge V19.1 — Deployment Verification (v8 repair pass)

Production candidate `19-1`, **repair pass v8**.

> **Scope of this pass:** v8 is a targeted Node.js patch update on
> top of v7. The v7 fixes are preserved unchanged — v8 only updates
> the pinned Node.js patch version. Specifically: v8 updates Node.js
> from 22.11.0 (the v6/v7 pin) to 22.23.3 — the latest Node.js 22 LTS
> patch as of 2026-10-10 (verified via
> <https://nodejs.org/dist/index.json> +
> <https://nodejs.org/en/about/previous-releases>). This is a PATCH
> update within the Node.js 22 major version — NOT a major version
> change. The `.node-version` file at the repo root (22.11.0 →
> 22.23.3) + the `NODE_VERSION` env var on the API service in
> `render.yaml` (22.11.0 → 22.23.3) were both updated; the `render.yaml`
> header comments + the production-notes block #6 were also updated to
> document the v8 patch update. v8 did NOT change Bun (still 1.3.14 —
> updating Bun would require regenerating the committed `bun.lock`,
> which is out of scope for v8). v8 did NOT change the Dockerfiles
> (still `oven/bun:1.3.14-alpine`). v8 did NOT change the
> `render-blueprint.test.ts` test (the existing `CHECK v6-7` test
> verifies `NODE_VERSION` matches `.node-version`; both are now
> `22.23.3`, so the test still passes — 35/35). The v8 pass touched
> NO application source files — only `.node-version` + `render.yaml`
> (env-var value + comments).
>
> **v7 scope (preserved unchanged by v8):** v7 corrects the v6
> `render.yaml` and pins the Dockerfiles. Specifically: v7 REMOVES
> the unsupported `runtimeVersion: "22"` field from the API service
> (the v6 pass had incorrectly KEPT this field, claiming it was a
> Render-supported property — it is NOT; verified authoritatively
> against Render's docs at <https://render.com/docs/blueprint-spec>
> + <https://render.com/docs/web-services> +
> <https://render.com/docs/node-version> — none of them mention
> `runtimeVersion` as a supported field). v7 ADDS the supported
> `NODE_VERSION=22.11.0` env var on the API service (the #1 supported
> method per <https://render.com/docs/node-version>; v8 later updates
> this value to 22.23.3). v7 CORRECTS the `CHECK v6-7` regression
> test in `tests/unit/render-blueprint.test.ts` (the v6 test REQUIRED
> `runtimeVersion: "22"` to be present — that test approved the very
> defect this repair removes; the v7 test now verifies
> `runtimeVersion` is ABSENT + `runtime: node` + `NODE_VERSION` are
> present + the `NODE_VERSION` value matches the `.node-version` file).
> v7 PINS both Dockerfiles to `oven/bun:1.3.14-alpine` (was floating
> `oven/bun:1-alpine` in v6). The v6 repairs are preserved unchanged
> where they are still correct: Redis is declared under `services:`
> with `type: keyvalue`, the `REDIS_URL` env-var references use the
> valid `fromService` form (not `fromDatabase`),
> `AUDIO_PROVIDER=internet-archive` is explicitly set, the
> `netlify.toml` `/api/*` proxy target matches the Render web service
> name `vidiaforge-api`, and the env-var names in this document
> match the actual names declared in `render.yaml` +
> `src/lib/env-validation.ts` + `src/lib/storage/s3-provider.ts` +
> `src/lib/auth.ts` (the v3 document incorrectly listed `AUTH_SECRET`,
> `S3_*`, and `NEXT_PUBLIC_API_BASE_URL` — none of those names exist
> in the codebase).
>
> **v6 additions (preserved in v7 + v8 unless noted):**
>
> 1. **Node + Bun version pinning** — `.node-version` (22.23.3 in
>    v8, was 22.11.0 in v6/v7) + `.bun-version` (1.3.14) files at
>    the repo root + `BUN_VERSION=1.3.14` env var on the API service.
>    The root `bun.lock` (285,722 bytes / 285KB, generated with Bun
>    1.3.14) is committed (it was MISSING in the v5 archive);
>    `bun install --frozen-lockfile` succeeds cleanly. **v7
>    CORRECTION:** the v6 `runtimeVersion: "22"` field on the API
>    service was NOT supported by Render's Blueprint schema (the
>    v6 pass had incorrectly concluded it was — that conclusion
>    was WRONG). v7 REMOVES the unsupported `runtimeVersion` field
>    and ADDS the supported `NODE_VERSION=22.11.0` env var (the #1
>    supported method per <https://render.com/docs/node-version>);
>    the `.node-version` file is preserved as the #2 supported
>    method (belt-and-suspenders). Both pin the same version — no
>    conflict. **v8 UPDATE:** the pinned Node.js patch was updated
>    from 22.11.0 to 22.23.3 (the latest 22.x LTS patch as of
>    2026-10-10, verified via <https://nodejs.org/dist/index.json>
>    + <https://nodejs.org/en/about/previous-releases>). The
>    `.node-version` file (now 22.23.3) + the `NODE_VERSION` env
>    var (now 22.23.3) remain consistent. v8 did NOT change Bun
>    (still 1.3.14).
> 2. **Redis connection-string format correction** — the v5 doc
>    claimed the INTERNAL Key Value connection string was `rediss://`
>    (TLS by default). This was INCORRECT. The INTERNAL connection
>    string (used when a Render service references the Key Value
>    service via `fromService`) is `redis://` (NO TLS) because the
>    traffic stays on Render's private network. The EXTERNAL connection
>    string (used when connecting from outside Render) is `rediss://`
>    (TLS). The existing `ioredis` client handles both forms natively
>    — no code change was required.
> 3. **Redis persistence** — `persistenceMode: journal-snapshot` is
>    now explicitly declared. This is a Render Blueprint supported
>    property on paid Key Value plans (the `256mb` plan is paid and
>    supports it). Journal-snapshot persistence REDUCES (but does NOT
>    eliminate) the risk of losing queued BullMQ jobs on a Redis
>    restart — a crash between snapshot intervals can still lose
>    journaled-but-not-yet-snapshotted data. Do NOT claim zero data
>    loss.
> 4. **Resource-cost awareness** — the `256mb` Key Value plan is
>    Render's smallest PAID plan (not free). The v5 doc said "smallest
>    supported Key Value plan" without noting it is paid. This v6 doc
>    corrects that. Any resource-plan decision must remain separate
>    from this configuration repair — the plan is NOT automatically
>    changed in v6 or v7.
> 5. **Environment-variable audit** — `NEXT_PUBLIC_API_URL` and
>    `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` are declared in
>    `render.yaml` as `sync: false` but are NOT consumed by the
>    current frontend code (the frontend uses relative
>    `fetch('/api/...')` paths which the Netlify `/api/*` proxy
>    forwards to Render; the server-side `STORAGE_PUBLIC_BASE_URL`
>    without the `NEXT_PUBLIC_` prefix is the one consumed by the
>    storage provider). Both variables are RETAINED to avoid breaking
>    a deployed environment that has come to expect them; setting them
>    has no effect on the current frontend behavior. They are NOT
>    removed.
>
> **v7 additions (preserved unchanged in v8 unless noted):**
>
> 1. **`runtimeVersion: "22"` REMOVED** — Render's Blueprint schema
>    does NOT support a `runtimeVersion` field on `web` services with
>    `runtime: node` (verified authoritatively against Render's docs:
>    blueprint-spec + web-services + node-version). The v6 pass had
>    KEPT this field, incorrectly concluding it was supported — that
>    conclusion was WRONG. v7 removes the field. v8 preserves the
>    removal (no `runtimeVersion` field exists in the v8 `render.yaml`).
> 2. **`NODE_VERSION=22.23.3` env var on the API service** (NEW in
>    v7 as 22.11.0; UPDATED in v8 to 22.23.3) — Render's #1 supported
>    method for pinning the Node.js version (per
>    <https://render.com/docs/node-version>, descending order of
>    precedence: env var > `.node-version` file > `.nvmrc` file >
>    build-image default). v7 adds this env var to the API service
>    in `render.yaml`; v8 updates the value from `22.11.0` to
>    `22.23.3` (the latest 22.x LTS patch as of 2026-10-10, verified
>    via <https://nodejs.org/dist/index.json>). The `.node-version`
>    file (22.23.3 in v8, was 22.11.0 in v6/v7) is preserved as the
>    #2 supported method (belt-and-suspenders). Both pin the same
>    version — no conflict.
> 3. **`CHECK v6-7` regression test CORRECTED in-place** (preserved
>    unchanged in v8) — the v6 version of
>    `tests/unit/render-blueprint.test.ts` `CHECK v6-7` test REQUIRED
>    `runtimeVersion: "22"` to be present on the API service. That
>    test approved the very defect this repair removes. The v7 test
>    now verifies: (a) `runtime: node` IS present (the supported
>    runtime declaration), (b) `runtimeVersion` is ABSENT (the
>    unsupported field removed), (c) the `NODE_VERSION` env var is
>    present + its value matches the `.node-version` file. The test
>    was verified in v7 to FAIL when `runtimeVersion: "22"` is
>    reintroduced (confirmed via a temporary reintroduction + test
>    run + restore). The v8 pass did NOT modify the test; it still
>    passes against the v8 render.yaml because the `NODE_VERSION` env
>    var value (now `22.23.3`) matches the `.node-version` file (now
>    `22.23.3`). No test count change — the render-blueprint suite
>    stays at 35 tests.
> 4. **Dockerfiles pinned to `oven/bun:1.3.14-alpine`** (preserved
>    unchanged in v8) — both `Dockerfile` (3 `FROM` lines) and
>    `worker.Dockerfile` (4 `FROM` lines) updated from the floating
>    `oven/bun:1-alpine` tag (a major-version tag that could pull any
>    1.x patch) to the exact patch-version pin `oven/bun:1.3.14-alpine`.
>    The `1.3.14-alpine` image was verified to exist on Docker Hub
>    (last pushed 2026-05-13, status active, supports amd64 + arm64).
>    The pinned tag matches `.bun-version` (1.3.14) + the `BUN_VERSION`
>    env var (1.3.14) + the root `bun.lock` (generated with Bun 1.3.14)
>    — no version conflict. The v8 pass did NOT change the Dockerfiles
>    (v8's scope was the Node.js version question only). **Docker
>    build NOT VERIFIED — no Docker daemon in the repair sandbox.**
>
> **v8 additions (NEW in this pass):**
>
> 1. **Node.js patch updated from 22.11.0 to 22.23.3** — the latest
>    Node.js 22 LTS patch as of 2026-10-10, verified via
>    <https://nodejs.org/dist/index.json> +
>    <https://nodejs.org/en/about/previous-releases>. This is a
>    within-major patch update (NOT a major version change). The
>    `.node-version` file (22.11.0 → 22.23.3) + the `NODE_VERSION`
>    env var on the API service (22.11.0 → 22.23.3) were both
>    updated; both remain consistent. The `render.yaml` header
>    comments + the production-notes block #6 were also updated to
>    document the v8 patch update. v8 did NOT change Bun (still
>    1.3.14). v8 did NOT change the Dockerfiles (still
>    `oven/bun:1.3.14-alpine`). v8 did NOT modify any application
>    source files. The existing `CHECK v6-7` test (corrected in
>    v7) continues to PASS in v8 because the env var value matches
>    `.node-version` (both now 22.23.3) — 35/35 render-blueprint
>    tests pass. All static checks that passed in v7 still pass in
>    v8: typecheck PASS (0 errors), unit tests PASS (399/399),
>    frozen install PASS (890 packages, 0 drift). Lint FAIL/PARTIAL
>    with 7 pre-existing errors (NOT newly introduced by v8).
>
> **No deployment was made in this pass.** All live-stack verification
> (Netlify routing, Render health, DB, Redis, S3, production build,
> end-to-end against a deployed URL) is **NOT VERIFIED**. The
> infrastructure-dependent items are also **BLOCKED** because the
> repair sandbox contains no PostgreSQL, Redis, S3, deployment access,
> or internet egress.
>
> **Static checks (HONEST reporting — NOT "all pass cleanly"):**
>
> - `bun install --frozen-lockfile` → **PASS** (890 packages, 0 drift,
>   exit 0)
> - `bun run typecheck` → **PASS** (0 errors, exit 0)
> - `bun test tests/unit/` → **PASS** (**399 tests pass**, 0 fail, 3021
>   `expect()` calls, across 17 files — including the
>   `render-blueprint.test.ts` structural test of `render.yaml` (35
>   tests, 107 `expect()` calls — the `CHECK v6-7` test was corrected
>   in-place in v7, preserved unchanged in v8; it still passes because
>   the `NODE_VERSION` env var value `22.23.3` matches the
>   `.node-version` file `22.23.3`), the `netlify-proxy.test.ts`
>   proxy-config test (8 tests), and the `sfx-labeling.test.ts`
>   labeling test (12 tests)).
> - `bun run lint` → **FAIL/PARTIAL** — 7 pre-existing
>   `react-hooks/set-state-in-effect` errors in v2-era files
>   (audio-panel.tsx, templates-panel.tsx, recording-dialog.tsx,
>   carousel.tsx, create-project-dialog.tsx, use-mobile.ts), exit
>   code 1, 0 warnings. **NOT a clean pass** — the v8 pass did NOT
>   introduce any new lint errors (the v8 edits touch only
>   `.node-version` + `render.yaml` — neither is a lint target),
>   but the 7 pre-existing errors remain. The v7 report incorrectly
>   claimed "static checks (lint + ...) pass cleanly" in multiple
>   places; the v8 pass corrects that contradiction.
>
> The root `bun.lock` (committed in v6, preserved in v7 + v8) was
> re-verified in v8 — `bun install --frozen-lockfile` succeeds cleanly
> (890 packages, 0 drift, exit 0). The production build (`bun run
> build`) was NOT run because it requires a valid `DATABASE_URL` at
> build time (Prisma generate step). The Docker build was NOT run
> because the repair sandbox has no Docker daemon.

## 1. Required environment variables (by name, NOT value)

> Secrets are listed by **NAME ONLY**. Never commit values to git. Set them in
> the Render dashboard (`sync: false` keys in `render.yaml`) or via
> `render env set`. The variable names below were verified against
> `render.yaml`, `src/lib/env-validation.ts`, `src/lib/storage/s3-provider.ts`,
> and `src/lib/auth.ts`.

### Frontend (Netlify)

- `NEXT_PUBLIC_API_URL` — Declared in `render.yaml` (`sync: false`) and in
  `src/lib/env-validation.ts` for documentation/forward-compatibility, but
  **NOT consumed by the frontend code**. The frontend uses relative
  `fetch('/api/...')` paths exclusively (verified: no `NEXT_PUBLIC_API_URL`
  reference anywhere under `src/`). Netlify's `/api/*` proxy (see §3) forwards
  those relative calls to the Render API at the same browser origin, which is
  what makes the `SameSite=Lax` session cookie work. Set `NEXT_PUBLIC_API_URL`
  **only** if you intend to switch the frontend to direct cross-origin Render
  calls (not recommended — breaks the `SameSite=Lax` session cookie).
- `NEXT_PUBLIC_APP_NAME` — Set to `VidiaForge` in `render.yaml` (informational;
  consumed by the frontend's `<title>` / branding UI).
- `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` — Declared in `render.yaml`
  (`sync: false`) but **NOT consumed by the frontend code** (v6 honest
  audit). The v5 doc incorrectly implied the browser uses this to
  resolve media URLs; in reality the frontend fetches assets via
  `/api/assets/${id}` (same-origin proxy through Netlify → Render). The
  server-side `STORAGE_PUBLIC_BASE_URL` (WITHOUT the `NEXT_PUBLIC_`
  prefix) is the one consumed by the storage provider
  (`src/lib/storage/s3-provider.ts` + `src/lib/storage/index.ts`) for
  constructing public CDN URLs. `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` is
  RETAINED in `render.yaml` to avoid breaking a deployed environment that
  has come to expect it; setting it has NO effect on the current frontend
  behavior. Do NOT remove it without auditing the deployed environment
  first.
- No DB, Redis, S3, or auth secrets belong on Netlify — those are
  backend-only.

### Backend API service (Render — `vidiaforge-api`, Node runtime)

- `NODE_ENV` — set to `production` by `render.yaml`.
- `NODE_VERSION` — set to `22.23.3` by `render.yaml` (NEW in v7 as
  22.11.0; UPDATED in v8 to 22.23.3 — the latest Node.js 22 LTS
  patch as of 2026-10-10, verified via
  <https://nodejs.org/dist/index.json> +
  <https://nodejs.org/en/about/previous-releases>). The #1 supported
  method for pinning the Node.js version on Render (per
  <https://render.com/docs/node-version>, descending order of
  precedence: `NODE_VERSION` env var > `.node-version` file >
  `.nvmrc` file > build-image default). Belt-and-suspenders with the
  root `.node-version` file (also `22.23.3` in v8, was `22.11.0` in
  v6/v7 — added in v6 as the #2 supported method). Both pin the
  same version — no conflict. The v6 `render.yaml` had an
  unsupported `runtimeVersion: "22"` field on the API service; v7
  REMOVED it (verified authoritatively against Render's docs at
  <https://render.com/docs/blueprint-spec> +
  <https://render.com/docs/web-services> +
  <https://render.com/docs/node-version> — none of them mention
  `runtimeVersion` as a supported field). v8 preserved the v7
  removal and updated only the pinned Node patch value
  (22.11.0 → 22.23.3).
- `BUN_VERSION` — set to `1.3.14` by `render.yaml` (v6, preserved
  in v7 + v8). Belt-and-suspenders with the root `.bun-version` file
  (also `1.3.14`). Render's Node runtime does NOT include Bun by
  default; the build image installs Bun when `bun` is invoked
  during the buildCommand. Both the env var + the `.bun-version`
  file ensure the installed Bun matches the version that produced
  the committed `bun.lock` (285KB, generated with Bun 1.3.14).
  Without this pin, Render may install a different Bun version
  that could fail `--frozen-lockfile` or produce a different
  dependency resolution.
- `DATABASE_URL` — PostgreSQL connection string. Injected by Render via
  `fromDatabase` referencing the `vidiaforge-db` resource's `connectionString`
  property. **Required for the app to start AND required for the production
  build to succeed** (the Next.js build invokes `prisma generate`, which reads
  `DATABASE_URL` from the environment even though it does not connect at
  generate time — Prisma 6 still requires a non-empty `DATABASE_URL` to be
  present or the generate step fails).
- `REDIS_URL` — Render Key Value connection string. Injected by Render via
  `fromService` (NOT `fromDatabase`) referencing the `vidiaforge-redis`
  keyvalue service's `connectionString` property. The INTERNAL connection
  string (which is what the API + worker receive via `fromService`) is
  `redis://` (NO TLS) — traffic stays on Render's private network. The
  EXTERNAL connection string (used when connecting from outside Render) is
  `rediss://` (TLS). The v5 doc incorrectly claimed the internal string
  was `rediss://`; this v6 doc corrects that. The existing `ioredis` client
  (see `src/lib/queue.ts` + the worker's `checkRedis()`) handles both
  `redis://` and `rediss://` URLs natively — no code change was required
  for either form. Required for the worker (render queue + media-ingestion
  queue + rate-limit token bucket) and for the API rate-limiter.
- `JWT_SECRET` — `sync: false`. Required for signed upload URLs (32+ chars).
- `SESSION_SECRET` — `sync: false`. Declared in `render.yaml` + in
  `src/lib/env-validation.ts` for future use. **The current cookie-based
  session implementation does NOT consume it**: the session token is generated
  with `crypto.randomBytes(SESSION_TOKEN_BYTES)` in `src/lib/auth.ts` and
  stored in PostgreSQL (`Session` table); the httpOnly cookie carries the
  opaque token, not a JWT-style signed token. `SESSION_SECRET` is reserved
  for a future migration to signed-cookie sessions (NextAuth.js-style). Set
  it to a 32+ character random string now so the rotation is non-blocking
  later.
- `STORAGE_PROVIDER` — `local` | `s3` | `r2`. Defaults to `local` in
  development; **production requires `s3` or `r2`** (`src/lib/env-validation.ts`
  throws a FATAL error if `STORAGE_PROVIDER=local` in production). Set to `s3`
  in `render.yaml`.
- `STORAGE_ENDPOINT` — `sync: false`. S3-compatible endpoint URL
  (e.g. `https://<account>.r2.cloudflarestorage.com` for Cloudflare R2, or
  the AWS S3 regional endpoint). Required when `STORAGE_PROVIDER` is `s3` or
  `r2`.
- `STORAGE_BUCKET` — `sync: false`. Bucket name. Required when
  `STORAGE_PROVIDER` is `s3` or `r2`.
- `STORAGE_REGION` — `sync: false`. Bucket region. Use `auto` for Cloudflare
  R2, `us-east-1` (or the appropriate AWS region) for AWS S3.
- `STORAGE_ACCESS_KEY` — `sync: false`. Bucket access key (secret).
- `STORAGE_SECRET_KEY` — `sync: false`. Bucket secret key (secret).
- `STORAGE_PUBLIC_BASE_URL` — `sync: false`. Public CDN URL fronting the
  bucket (optional but recommended — used by `S3StorageProvider.getPublicUrl()`
  to build browser-facing media URLs).
- `AI_PROVIDER` — set to `zai` in `render.yaml`.
- `AUDIO_PROVIDER` — set to `internet-archive` in `render.yaml` (v5). The
  Internet Archive adapter needs no credentials (public API). Alternative
  values: `jamendo` (requires `JAMENDO_CLIENT_ID`) or `none` (honest empty
  music catalog).
- `JAMENDO_CLIENT_ID` — `sync: false`. Required ONLY when
  `AUDIO_PROVIDER=jamendo`. Free `client_id` obtainable from
  <https://developer.jamendo.com/admin/apps>. Not required for the default
  `internet-archive` provider.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` — `sync: false`.
  Optional; only required when the corresponding AI provider is selected.
- `TRANSCRIPTION_PROVIDER` — `openai` | `deepgram` | `local` | (unset).
  Required for AI transcription features. Unset → transcription disabled.
- `TRANSCRIPTION_API_KEY` — `sync: false`. Required when
  `TRANSCRIPTION_PROVIDER` is set to a hosted provider (not `local`).
- `TRANSLATION_PROVIDER` — `openai` | `deepgram` | (unset). Required for AI
  translation features. Unset → translation disabled.
- `TRANSLATION_API_KEY` — `sync: false`. Required when
  `TRANSLATION_PROVIDER` is set to a hosted provider.
- `CORS_ORIGIN` — `sync: false`. Set to the Netlify frontend origin
  (e.g. `https://vidiaforge.netlify.app`).
- `NEXT_PUBLIC_API_URL` — `sync: false`. Declared on the API service in
  `render.yaml` but **NOT consumed by the frontend code** (the frontend
  uses relative `fetch('/api/...')` paths which Netlify proxies to this
  Render API). See the Frontend (Netlify) section above. Setting this
  env var has NO effect on the current frontend behavior; it is retained
  to avoid breaking a deployed environment that has come to expect it.
  Do NOT remove it without auditing the deployed environment first.

### Worker service (Render — `vidiaforge-worker`, Docker runtime)

The worker is a Render `worker` service type using the `docker` runtime
(`worker.Dockerfile` installs + verifies ffmpeg/ffprobe at build time). It
shares most of its env vars with the API:

- `NODE_ENV` — `production` (inlined in `render.yaml`).
- `DATABASE_URL` — same as the API (injected via `fromDatabase` referencing
  `vidiaforge-db`).
- `REDIS_URL` — same as the API (injected via `fromService` referencing
  `vidiaforge-redis` keyvalue service, `property: connectionString`).
- `STORAGE_PROVIDER` — `s3` (inlined). The worker writes media-ingestion
  thumbnails + render outputs to the bucket.
- `STORAGE_ENDPOINT` / `STORAGE_BUCKET` / `STORAGE_REGION` /
  `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_PUBLIC_BASE_URL` —
  `sync: false`. Same as the API. The worker needs write access to the
  bucket; the API needs read + presign access. Set both to the same
  credentials (or use IAM-scoped sub-credentials).
- `UPLOAD_DIR` — `/app/uploads` (inlined; `worker.Dockerfile` default).
- `TEMP_DIR` — `/app/tmp` (inlined; `worker.Dockerfile` default).
- `WORKER_CONCURRENCY` — `2` (inlined). Number of concurrent render jobs.
- `WORKER_PORT` — `3001` (inlined). `/health` endpoint port.
- `AI_PROVIDER` — `zai` (inlined).
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `TRANSCRIPTION_*` /
  `TRANSLATION_*` — `sync: false`. Same as the API; the worker calls these
  for AI transcription / translation jobs.
- The worker does NOT consume `CORS_ORIGIN`, `NEXT_PUBLIC_*`, `AUDIO_PROVIDER`,
  `JAMENDO_CLIENT_ID`, `JWT_SECRET`, or `SESSION_SECRET` — those are
  browser-facing or API-only.

### Redis (Render Key Value — `vidiaforge-redis`)

- No manual env-var configuration is required on the Redis resource itself —
  Render injects the `connectionString` automatically when an API/worker
  service references it via `fromService` (see the API + worker env-var
  lists above). The INTERNAL connection string Render injects is
  `redis://` (NO TLS) because the traffic stays on Render's private
  network. The EXTERNAL connection string (used when connecting from
  outside Render) is `rediss://` (TLS). The v5 doc incorrectly claimed the
  internal string was `rediss://`; this v6 doc corrects that. The existing
  `ioredis` client (`src/lib/queue.ts` + the worker's `checkRedis()`)
  handles both `redis://` and `rediss://` URLs natively — no code change
  was required for either form.
- The Key Value resource is declared under `services:` with `type: keyvalue`
  (NOT under `databases:` — that section is reserved for Render-managed
  PostgreSQL only).
- `plan: 256mb` — Render's smallest PAID Key Value plan identifier. This
  is NOT a free plan; see Render's pricing for the current cost. The v5
  doc said "smallest supported Key Value plan" without noting it is paid —
  this v6 doc corrects that. Any resource-plan decision (upgrading for
  production load) must remain separate from this configuration repair;
  the plan is NOT automatically changed in v6.
- `maxmemoryPolicy: noeviction` — prevents BullMQ queue data from being
  evicted under memory pressure (preserved from v5, unchanged in v6).
  NOTE: this does NOT guarantee durability across Redis restarts — see §5.
- `persistenceMode: journal-snapshot` (NEW in v6) — a Render Blueprint
  supported property on paid Key Value plans (the `256mb` plan is paid
  and supports it). Journal-snapshot persistence provides periodic
  snapshots + an append-only journal for recovery between snapshots.
  This REDUCES (but does NOT eliminate) the risk of losing queued BullMQ
  jobs on a Redis restart. A crash between snapshot intervals can still
  lose journaled-but-not-yet-snapshotted data. Do NOT claim zero data
  loss (see §5 for the full durability story).
- `ipAllowList: []` — private/internal only, no public inbound access.
  Render services connect via the internal `redis://` connection string.
- Render's Key Value service may be Valkey-based (not Redis 7). Do NOT
  assume a specific server version. The existing `ioredis` client handles
  the wire protocol natively — no code change was required.

### Runtime version pinning (v6 + v7 + v8)

v6 adds three files at the repo root + one env var; v7 ADDS the
`NODE_VERSION` env var + REMOVES the unsupported `runtimeVersion`
field + PINS the Dockerfiles to make the build fully reproducible
across environments; v8 UPDATES the Node.js patch from 22.11.0 to
22.23.3 (the latest 22.x LTS patch as of 2026-10-10, verified via
<https://nodejs.org/dist/index.json> +
<https://nodejs.org/en/about/previous-releases>):

- `.node-version` (`22.23.3` in v8, was `22.11.0` in v6/v7) — pins
  the exact Node patch version. Render's `node` runtime respects
  this file (and `.nvmrc`). The `.node-version` file is Render's
  **#2 supported method** for pinning the Node.js version (per
  <https://render.com/docs/node-version>). The #1 supported method
  is the `NODE_VERSION` env var (see the next bullet).
- **`NODE_VERSION=22.23.3` env var on the API service in
  `render.yaml`** (NEW in v7 as `22.11.0`; UPDATED in v8 to
  `22.23.3`) — Render's **#1 supported method** for pinning the
  Node.js version (per <https://render.com/docs/node-version>,
  descending order of precedence: env var > `.node-version` file >
  `.nvmrc` file > build-image default). The v6 `render.yaml` had
  an unsupported `runtimeVersion: "22"` field on the API service;
  v7 REMOVED it (verified authoritatively against Render's docs at
  <https://render.com/docs/blueprint-spec> +
  <https://render.com/docs/web-services> +
  <https://render.com/docs/node-version> — none of them mention
  `runtimeVersion` as a supported field). The v6 conclusion that
  `runtimeVersion` was supported was INCORRECT. v7 uses BOTH the
  #1 supported method (the env var) AND the #2 supported method
  (the `.node-version` file) — both pin Node 22.11.0 (v7) / 22.23.3
  (v8), no conflict. v8 updated both declarations consistently to
  22.23.3.
- `.bun-version` (`1.3.14`) — pins the Bun version. Render's Bun
  installer (used when `bun` is invoked during the buildCommand)
  respects this file. The `BUN_VERSION=1.3.14` env var on the API
  service is belt-and-suspenders with `.bun-version` (in case the
  build image does not consult the file).
- `bun.lock` (285,722 bytes / 285KB, committed in v6, preserved in
  v7) — the root lockfile generated by `bun install` with Bun
  1.3.14. Was MISSING in the v5 archive (a v5 audit note: the v5
  archive shipped without a root lockfile, which made
  `bun install --frozen-lockfile` non-reproducible). v6 commits the
  lockfile; v7 re-verifies `bun install --frozen-lockfile` succeeds
  cleanly with no changes (890 packages, 0 drift, exit 0).
- The worker service does NOT need a `BUN_VERSION` env var because
  its Docker base image already pins Bun. **v7 pinned both
  Dockerfiles to `oven/bun:1.3.14-alpine`** (was the floating
  `oven/bun:1-alpine` tag in v6). The `1.3.14-alpine` image was
  verified to exist on Docker Hub (last pushed 2026-05-13, status
  active, supports amd64 + arm64). The `.bun-version` file is also
  respected by `bun install` inside the image. The pinned Docker tag
  matches `.bun-version` (1.3.14) + the `BUN_VERSION` env var
  (1.3.14) + the root `bun.lock` (generated with Bun 1.3.14) — no
  version conflict. **Docker build NOT VERIFIED — no Docker daemon
  in the repair sandbox.**

## 2. Netlify routing checks

**Status: NOT VERIFIED — BLOCKED (no deployment access in sandbox)**

`netlify.toml` was modified in the v5 pass (preserved unchanged in v6 + v7): the
`/api/*` proxy target was corrected to match the Render web service name
declared in `render.yaml` (`vidiaforge-api`). The previous target
`https://vidiaforge.onrender.com` did not match the service name and would
have routed to a nonexistent host.

No deployment was made, so the live Netlify routing cannot be verified from
this sandbox. What SHOULD be true once deployed (verified by file inspection
only):

1. **`netlify.toml` redirects:** `/api/*` is proxied to the Render backend
   via:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://vidiaforge-api.onrender.com/api/:splat"
     status = 200
     force = true
     [redirects.headers]
       X-Forwarded-Host = "vidiaforge.netlify.app"
   ```
   This target matches the Render web service name `vidiaforge-api` declared
   in `render.yaml`. `status = 200` makes Netlify act as a transparent
   same-origin proxy (not a 30x redirect), so the browser sees the request
   as same-origin — required for the session cookie (`SameSite=Lax`) to
   flow correctly. `force = true` overrides any Next.js rewrites that would
   otherwise intercept `/api/*` and serve a frontend page. The
   `X-Forwarded-Host` header tells the Render API which Netlify origin
   initiated the request.
2. **Build command:** `bun run build`.
3. **Publish directory:** `.next` (the `@netlify/plugin-nextjs` plugin
   handles the App-Router SSR integration).
4. **Environment variables:** only `NEXT_PUBLIC_*` vars belong here. Server
   secrets must NOT be set on Netlify.
5. **Netlify proxy structural test:** `tests/unit/netlify-proxy.test.ts`
   parses `netlify.toml` and asserts the corrected target hostname + the
   `status = 200` + `force = true` semantics. This test DID pass in the v6
   sandbox (same as v5 — `netlify.toml` is unchanged in v6). The live
   routing against a deployed Netlify site is still NOT VERIFIED.

Manual verification against the deployed stack is required before promoting
to production (see §9, step 10).

## 3. Render health checks

**Status: NOT VERIFIED — BLOCKED (no Render credentials in sandbox)**

No deployment was made in this pass. The `render.yaml` blueprint was
repaired in v5 and hardened in v6 + v7 + v8 (Node + Bun version
pinning, Redis connection-string format correction, Redis
persistence declaration, v7 `runtimeVersion` removal + `NODE_VERSION`
env var addition + Dockerfile pinning, v8 Node.js patch update
22.11.0 → 22.23.3 — see §5 below for the Redis-specific changes).

What SHOULD be true once deployed (verified by file inspection only):

1. **Web service `vidiaforge-api`:** Node 22 runtime (major `22`
   selected via the `NODE_VERSION=22.23.3` env var in `render.yaml`
   (NEW in v7 as 22.11.0; UPDATED in v8 to 22.23.3 — the latest 22.x
   LTS patch as of 2026-10-10, verified via
   <https://nodejs.org/dist/index.json>; Render's #1 supported
   method per <https://render.com/docs/node-version>; the v6
   `runtimeVersion: "22"` field was REMOVED in v7 — it was NOT a
   supported Render Blueprint field); exact patch `22.23.3` also
   pinned via `.node-version` at the repo root (added in v6 as
   `22.11.0`, updated in v8 to `22.23.3` — the #2 supported method,
   belt-and-suspenders), Bun `1.3.14` pinned via `.bun-version` + the `BUN_VERSION` env var
   (v6), health check at `/api/health`, auto-deploy from `main`,
   pre-deploy runs `bun run db:generate && bun run db:migrate:deploy`.
   Start command: `bun .next/standalone/server.js` (Next.js
   standalone build).
2. **Worker service `vidiaforge-worker`:** Docker runtime
   (`worker.Dockerfile` installs + verifies ffmpeg/ffprobe at build
   time), Bun pinned via the `oven/bun:1.3.14-alpine` base image
   (v7 — was the floating `oven/bun:1-alpine` tag in v6; the image
   was verified to exist on Docker Hub; no `BUN_VERSION` env var
   needed — the pinned image tag is the source of truth), exposes
   `/health` on port 3001, logs `VIDIAFORGE WORKER READY` only when
   Redis + PostgreSQL + ffmpeg are all reachable.
3. **Key Value service `vidiaforge-redis`:** declared under `services:` with
   `type: keyvalue`, plan `256mb` (paid — Render's smallest PAID plan),
   `maxmemoryPolicy: noeviction` (preserved from v5), `persistenceMode:
   journal-snapshot` (NEW in v6 — REDUCES but does NOT eliminate the risk
   of losing queued jobs on Redis restart), `ipAllowList: []` (private
   only). The INTERNAL connection string Render injects via `fromService`
   is `redis://` (NO TLS); the EXTERNAL connection string is `rediss://`
   (TLS) — see §5 for the v6 connection-string format correction.
4. **PostgreSQL database `vidiaforge-db`:** declared under `databases:`,
   plan `starter`, region `oregon`, no `ipAllowList` (private/internal
   only on Render).

The `render.yaml` structural test (`tests/unit/render-blueprint.test.ts`)
parses the blueprint and asserts all of the above. This test DID pass
in the v8 sandbox (35 tests, 107 `expect()` calls — same suite count
as v6/v7, with the `CHECK v6-7` test corrected in-place in v7 +
preserved unchanged in v8; it still passes because the `NODE_VERSION`
env var value `22.23.3` matches the `.node-version` file `22.23.3`).
The live
`/api/health` / `/api/health/ready` / `/api/health/live` responses cannot
be verified from this sandbox. Manual verification against the deployed
Render stack is required (see §9, steps 1–4 + 7–8).

## 4. Database connectivity

**Status: NOT VERIFIED — BLOCKED (no PostgreSQL in sandbox)**

No PostgreSQL is provisioned in the repair sandbox. The Prisma migrations
(`prisma/migrations/`) are unchanged in this pass and are expected to apply
cleanly, but `bun run db:migrate:deploy` was NOT run.

To verify once provisioned:

```bash
# After deploying render.yaml, Render injects DATABASE_URL into the API +
# worker services via fromDatabase. Verify the migration applied cleanly
# in the API service's pre-deploy log:
#   bun run db:generate && bun run db:migrate:deploy
# Then check the live health endpoint:
curl https://vidiaforge-api.onrender.com/api/health
# Expected: 200 OK + {"status":"ok","db":"connected"}
```

## 5. Redis connectivity

**Status: NOT VERIFIED — BLOCKED (no Render Key Value in sandbox)**

No Render Key Value instance is provisioned in the repair sandbox. The
worker's startup validation (`mini-services/worker/src/index.ts`) pings
Redis at boot and refuses to start if unreachable, but that path was not
exercised in this pass.

### v5 corrected configuration (preserved in v6, verified by file inspection of `render.yaml`)

- The Redis resource is named `vidiaforge-redis` and is declared under
  `services:` with `type: keyvalue` (NOT under `databases:`, which is
  reserved for Render-managed PostgreSQL).
- `maxmemoryPolicy: noeviction` — prevents BullMQ queue data from being
  evicted under memory pressure. BullMQ stores job metadata + queues in
  Redis; eviction would cause silent job loss. (Preserved from v5,
  unchanged in v6.)
- `ipAllowList: []` — private/internal only, no public inbound access.
- Both the API + worker reference the Redis service via `fromService` with
  `property: connectionString` (NOT via `fromDatabase`). The injected env var
  is `REDIS_URL`.
- Render's Key Value service may be Valkey-based (not Redis 7) — do NOT
  promise a specific Redis server version.

### v6 connection-string format correction (documented honestly)

The v5 doc claimed the INTERNAL Key Value connection string Render injects
was `rediss://` (TLS by default). **This was INCORRECT.** Render's Key
Value service exposes two connection strings:

- **INTERNAL** (used when a Render service references the Key Value service
  via `fromService`): `redis://` (NO TLS) — traffic stays on Render's
  private network.
- **EXTERNAL** (used when connecting from outside Render, e.g. from a
  local dev machine or a non-Render service): `rediss://` (TLS).

The API + worker both reference the Key Value service via `fromService`,
so they receive the INTERNAL `redis://` string. The existing `ioredis`
client (`src/lib/queue.ts` + worker's `checkRedis()`) already accepts both
`redis://` and `rediss://` URLs natively — no code change was required for
either form. The previous v5 doc + comments incorrectly claimed the
internal string was `rediss://`; this v6 doc corrects that.

### v6 plan + persistence configuration (documented honestly)

- `plan: 256mb` — Render's smallest PAID Key Value plan identifier. This
  is NOT a free plan; see Render's pricing for the current cost. The v5
  doc said "smallest supported Key Value plan" without noting it is paid;
  this v6 doc corrects that. The plan is NOT automatically changed in v6 —
  any resource-plan decision (upgrading for production load) must remain
  separate from this configuration repair.
- `persistenceMode: journal-snapshot` (NEW in v6) — a Render Blueprint
  supported property on paid Key Value plans (the `256mb` plan is paid
  and supports it). Journal-snapshot persistence provides periodic
  snapshots + an append-only journal for recovery between snapshots.
  This is Render's most durable Key Value persistence option. It is NOT
  equivalent to Redis AOF + RDB combined.

### PERSISTENCE LIMITATION (documented honestly — do NOT claim zero data loss)

`maxmemoryPolicy: noeviction` prevents in-memory eviction under memory
pressure (BullMQ queue data is never evicted while Redis is running).
`persistenceMode: journal-snapshot` (v6) REDUCES — but does NOT eliminate —
the risk of losing queued BullMQ jobs on a Redis restart. Render's Key
Value service may restart on maintenance. BullMQ jobs that were queued
but not yet picked up by a worker **may still be lost on Redis restart**.
A crash between snapshot intervals can still lose the
journaled-but-not-yet-snapshotted data.

The worker's stale-job recovery (`mini-services/worker/src/recovery.ts`)
handles jobs that were in-progress when Redis restarted (it reclaims them
on the next worker boot). For mission-critical render jobs, the API's
enqueue path is idempotent via `src/lib/render/render-identity.ts` +
`src/lib/render/timeline-hash.ts` (deterministic identity + content hash)
so a lost queue entry can be safely re-enqueued by the client. This is
the honest durability story. Do NOT claim zero data loss.

To verify once provisioned:

```bash
# Worker logs at startup should contain "VIDIAFORGE WORKER READY" — that
# log line only fires when Redis + PostgreSQL + ffmpeg are ALL reachable.
# Query the API /api/health endpoint (the worker /health is on port 3001
# private network only — use the API health as the proxy):
curl https://vidiaforge-api.onrender.com/api/health
# Expected JSON should include "redis":"ok" in the checks object.
```

## 6. Storage verification

**Status: NOT VERIFIED — BLOCKED (no S3-compatible storage in sandbox)**

No S3-compatible storage is provisioned in the repair sandbox. The
`STORAGE_PROVIDER=local` fallback works for ephemeral single-instance
deploys but is NOT suitable for production — the API + worker are
separate Render services and do not share a filesystem. Production must
use `STORAGE_PROVIDER=s3` (or `r2`) with the `STORAGE_*` env vars set on
Render. The storage provider is selected in `src/lib/storage/index.ts`
based on `STORAGE_PROVIDER`; the S3 implementation is
`src/lib/storage/s3-provider.ts` (`S3StorageProvider`), which dynamically
imports `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` so the app
still boots if those packages aren't installed.

To verify once provisioned:

```bash
# Upload a small file through the media panel and confirm it appears in
# the bucket. Or, after the worker processes a media-ingestion job, the
# asset should have a real thumbnail URL pointing to the
# STORAGE_PUBLIC_BASE_URL.
curl https://vidiaforge-api.onrender.com/api/health
# Expected JSON should include "storage":"ok" in the checks object.
```

## 7. Build status

**Status: NOT VERIFIED — BLOCKED (no DATABASE_URL in sandbox)**

`bun run build` was **NOT run** in this pass. The production build requires
a valid `DATABASE_URL` at build time (Prisma generate is invoked during
`next build`), which is not available in the repair sandbox.

### v6 lockfile verification (NEW in v6)

The root `bun.lock` (285,722 bytes / 285KB) was MISSING in the v5 archive
— the v5 archive shipped without a root lockfile, which made
`bun install --frozen-lockfile` non-reproducible. v6 commits the lockfile
(generated by `bun install` with Bun 1.3.14, the same version pinned in
`.bun-version` + the `BUN_VERSION` env var on the API service). The
lockfile was verified in the v6 sandbox (and re-verified in the v7 +
v8 sandboxes — identical result, 890 packages, 0 drift, exit 0):

```bash
$ bun install --frozen-lockfile
bun install v1.3.14 (0d9b296a)

Checked 890 installs (no changes) [48.00ms]
```

This confirms the lockfile is reproducible against the pinned Bun version
and that the v8 build will use the exact dependency set the v5/v6 test
report was generated against. v7 re-verifies this; v8 re-verifies this
again. The v7 edits (render.yaml `runtimeVersion` removal + `NODE_VERSION`
envVar addition + `CHECK v6-7` test correction + 7 Dockerfile `FROM` lines)
+ the v8 edits (`.node-version` 22.11.0 → 22.23.3 + `NODE_VERSION` env var
value 22.11.0 → 22.23.3 + `render.yaml` header comments + production-notes
block #6) do NOT touch the lockfile or `package.json`, so the frozen
install result is identical to v6.

### Static checks that DID pass in the v8 repair sandbox

| Check | Command | Result |
| --- | --- | --- |
| TypeScript typecheck | `bun run typecheck` | PASS — 0 errors, exit 0 |
| Unit tests (all) | `bun test tests/unit/` | PASS — **399 tests**, 0 fail, 3021 `expect()` calls, across 17 files (v3 baseline: 345; v5: +37 = 382; v6: +18 = 399; v7: 0 change — the `CHECK v6-7` test was corrected in-place, no tests added or removed; v8: 0 change — no test files modified) |
| Render blueprint structural test | `bun test tests/unit/render-blueprint.test.ts` | PASS — **35 tests**, 0 fail, 107 `expect()` calls (parses `render.yaml` and asserts: Redis under `services:` with `type: keyvalue`, `fromService` references, `maxmemoryPolicy: noeviction`, `ipAllowList: []`, `persistenceMode: journal-snapshot`, region consistency, PostgreSQL under `databases:` with `fromDatabase` reference for `DATABASE_URL`, `AUDIO_PROVIDER` explicitly set, no hardcoded Redis credentials, service names unique, `.node-version` + `.bun-version` + `bun.lock` presence, `BUN_VERSION` env var present, `NODE_VERSION` env var present + matches `.node-version` (both now 22.23.3 in v8), `runtimeVersion` ABSENT). v7 correction: the v6 `CHECK v6-7` test was corrected in-place to verify `runtimeVersion` is ABSENT + `runtime: node` + `NODE_VERSION` are present + matches `.node-version`. v8 preservation: the test still passes because the env var value (now `22.23.3`) matches the `.node-version` file (now `22.23.3`). The corrected test was verified to FAIL when `runtimeVersion: "22"` is reintroduced |
| Netlify proxy test | `bun test tests/unit/netlify-proxy.test.ts` | PASS — 8 tests (asserts the corrected `/api/*` proxy target `https://vidiaforge-api.onrender.com/api/:splat` — unchanged from v5/v6/v7/v8) |
| SFX labeling test | `bun test tests/unit/sfx-labeling.test.ts` | PASS — 12 tests (verifies the 8 SFX labels are correct + non-placeholder — unchanged from v5/v6/v7) |
| Render smoke | `bun test tests/render-smoke.test.ts` | PASS — 2 pass, 1 skip, 30 `expect()` calls (H.264 + AAC audio stream present — unchanged from v5/v6/v7) |
| Keyframe render E2E | `bun test tests/integration/keyframe-production-render-e2e.test.ts` | PASS — 1 test, 18 `expect()` calls (X position LEFT → CENTER → RIGHT verified through the production renderer — unchanged from v5/v6/v7) |
| Template thumbnails | `bun run scripts/generate-template-thumbnails.ts` | NOT RUN in v7 + v8 (script unchanged from v5/v6; v6 result 13/13 thumbnails regenerated — inherited, NOT re-verified in v7 or v8) |
| **Lockfile install (v6, re-verified in v7 + v8)** | `bun install --frozen-lockfile` | PASS — no changes (890 packages, 0 drift, exit 0); the committed `bun.lock` is reproducible against the pinned Bun 1.3.14 |
| Lint | `bun run lint` | **FAIL/PARTIAL** — 7 pre-existing errors, 0 warnings, exit code 1 in files NOT modified in v5/v6/v7/v8 — all `react-hooks/set-state-in-effect` rule violations (audio-panel.tsx line 161, templates-panel.tsx line 118, recording-dialog.tsx lines 71 + 127, carousel.tsx line 98, create-project-dialog.tsx line 141, use-mobile.ts line 14). v7 + v8 introduce 0 new lint errors (v7 changes only `render.yaml` + the `CHECK v6-7` test + 7 Dockerfile `FROM` lines; v8 changes only `.node-version` + `render.yaml` — none are lint targets). The 7 pre-existing errors remain — lint is NOT a clean pass |

The v5-specific tests (`render-blueprint.test.ts`, `netlify-proxy.test.ts`)
are still the most directly relevant to the deployment blueprint + proxy
target. They DID pass in v8 (35 + 8 tests). The v6 lockfile install
verification (re-verified in v7 + v8) closes the v5 reproducibility
gap. The v7 corrections (the `CHECK v6-7` test correction + the
Dockerfile pinning) close the v6 correctness gap (`runtimeVersion` was
unsupported; the Dockerfiles were floating-tag). The v8 Node.js patch
update (22.11.0 → 22.23.3) closes the v7 patch-version-freshness gap.
The production build did NOT run. The Docker build did NOT run. Lint
FAIL/PARTIAL with 7 pre-existing errors (NOT newly introduced by v8).

## 8. Deployment status

**Status: NOT VERIFIED**

No deployment to Netlify or Render was made in this pass. The v7
changes live only in the source tree (`render.yaml` — `runtimeVersion`
removed + `NODE_VERSION` env var added + comment corrections; the
`CHECK v6-7` test in `tests/unit/render-blueprint.test.ts` corrected
in-place; both Dockerfiles pinned to `oven/bun:1.3.14-alpine`); the v8
changes also live only in the source tree (`.node-version` updated
22.11.0 → 22.23.3; `render.yaml` — the `NODE_VERSION` env var value
updated 22.11.0 → 22.23.3 + the header comments + production-notes
block #6 updated to document the v8 patch update; this document + the
3 other docs updated). The v6 changes are preserved
(`render.yaml` — `BUN_VERSION` env var + `persistenceMode:
journal-snapshot` + corrected `redis://` vs `rediss://` comments;
the root `bun.lock` + `.node-version` + `.bun-version` files at
the repo root; the v6 regression checks in `render-blueprint.test.ts`).
To promote to production:

1. Commit + push the repaired code to `main`.
2. Render auto-deploys from `main` — watch the deploy logs for
   `db:generate` + `db:migrate:deploy` + `bun install --frozen-lockfile`
   + `bun run build` + `bun .next/standalone/server.js`. (v7: Render
   should also report Node `v22.11.0` — pinned via the `NODE_VERSION`
   env var, the #1 supported method; the unsupported v6
   `runtimeVersion: "22"` field is no longer in `render.yaml`. v8:
   Render should now report Node `v22.23.3` instead — the v8 pass
   updated the pinned Node patch from `22.11.0` to `22.23.3`, the
   latest 22.x LTS patch as of 2026-10-10.)
3. Netlify auto-deploys from `main` — watch the build logs for
   `bun run build` success + the publish step.
4. The worker (Docker runtime) auto-deploys from `main` — watch the
   worker logs for `VIDIAFORGE WORKER READY`. (v7: the worker Docker
   image is now `oven/bun:1.3.14-alpine` — the pinned patch version,
   not the floating `oven/bun:1-alpine` tag from v6. v8: the worker
   Docker image is unchanged — v8 did not modify the Dockerfiles.)
5. No Prisma migration is required in this pass (the schema is unchanged
   from v4/v5). The pre-deploy `bun run db:migrate:deploy` will be a no-op.
6. No new secrets are required beyond those already declared in
   `render.yaml`. The v5 env-var changes are preserved (and unchanged in
   v6 + v7 + v8 unless noted):
   - `AUDIO_PROVIDER=internet-archive` is explicitly set (preserved from
     v5). No credential needed.
   - The Redis `fromService` reference replaces the invalid `fromDatabase`
     reference (preserved from v5); this is a blueprint-only change — the
     `REDIS_URL` env var consumed by the code is unchanged.
   - `SESSION_SECRET` is declared in `render.yaml` (`sync: false`) but is
     NOT consumed by the current cookie-based session implementation —
     set it anyway so a future migration to signed-cookie sessions is
     non-blocking.
   - `STORAGE_*` env vars (the v3 doc incorrectly listed `S3_*` names —
     `S3_*` does NOT exist anywhere in the codebase; the canonical names
     are `STORAGE_*`).
   - `NEXT_PUBLIC_API_URL` is declared in `render.yaml` (`sync: false`)
     but is NOT consumed by the frontend; the frontend uses relative
     `/api/*` paths which Netlify proxies to Render. RETAINED in v6 to
     avoid breaking a deployed environment that has come to expect it.
   - `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` is declared in `render.yaml`
     (`sync: false`) but is NOT consumed by the frontend; the frontend
     fetches assets via `/api/assets/${id}`. The server-side
     `STORAGE_PUBLIC_BASE_URL` (without the `NEXT_PUBLIC_` prefix) is
     the one consumed by the storage provider. RETAINED in v6 + v7
     to avoid breaking a deployed environment.

   The v6 env-var changes are (preserved in v7 + v8 unless noted):
   - `BUN_VERSION=1.3.14` is now explicitly set on the API service
     (belt-and-suspenders with the `.bun-version` file at the repo
     root).
   - `persistenceMode: journal-snapshot` is now explicitly declared on
     the Redis Key Value service (paid `256mb` plan supports it).

   The v7 env-var changes are (preserved in v8 unless noted):
   - `NODE_VERSION=22.11.0` was added to the API service in v7
     (the #1 supported method per <https://render.com/docs/node-version>;
     belt-and-suspenders with the `.node-version` file at the repo
     root — the #2 supported method; both pin the same version, no
     conflict).
   - The unsupported v6 `runtimeVersion: "22"` field was REMOVED —
     verified authoritatively against Render's docs (blueprint-spec +
     web-services + node-version) that `runtimeVersion` is NOT a
     supported Render Blueprint property. The v6 conclusion that it
     was supported was INCORRECT.

   The v8 env-var changes are (NEW in this pass):
   - `NODE_VERSION` value updated from `22.11.0` to `22.23.3` on
     the API service (still the #1 supported method per
     <https://render.com/docs/node-version>; the `.node-version` file
     at the repo root was also updated from `22.11.0` to `22.23.3` —
     the #2 supported method; both pin the same v8 value, no
     conflict). The v8 update is the latest 22.x LTS patch as of
     2026-10-10 (verified via <https://nodejs.org/dist/index.json>
     + <https://nodejs.org/en/about/previous-releases>). This is a
     within-major patch update — NOT a major version change.

## 9. Manual verification steps (16-step post-deployment checklist)

For the deployment engineer to run once the stack is provisioned. These
map to V19.1 prompt Phase 8 §10.3. Each step should be checked off
individually against the deployed stack — none were exercised in this
sandbox. Steps 1, 4, 5, 15, and 16 were updated in v6 (and further
updated in v7 for steps 15 + 16; updated in v8 for step 15); steps 2,
3, 6–14 are unchanged from v5. (v7 added an explicit check for
`NODE_VERSION` env var + the absence of `runtimeVersion` in step 15;
v7 also pinned the Dockerfiles to `oven/bun:1.3.14-alpine` which is
reflected in step 4 of the Render health-checks section §3. v8
updated the expected Node version in step 15 from `v22.11.0` to
`v22.23.3`.)

1. - [ ] **Render provisions the API** — `vidiaforge-api` web service
      reaches `Running` state in the Render dashboard; the deploy log
      shows `bun install --frozen-lockfile` (v6 — was just `bun install`
      in v5) + `db:generate` + `db:migrate:deploy` + `bun run build` +
      `bun .next/standalone/server.js` all completing successfully.
2. - [ ] **Render provisions the worker** — `vidiaforge-worker` background
      service reaches `Running` state; the worker log contains
      `VIDIAFORGE WORKER READY` (this only fires when Redis + PostgreSQL +
      ffmpeg are all reachable at boot).
3. - [ ] **Render provisions PostgreSQL** — `vidiaforge-db` database
      reaches `Available` state; the API's `preDeployCommand` ran
      `bun run db:migrate:deploy` cleanly (visible in the API deploy log).
4. - [ ] **Render provisions the Key Value service** — `vidiaforge-redis`
      (type: keyvalue, plan `256mb` — Render's smallest PAID plan, NOT
      free; v6 correction: the v5 doc did not note this is a paid plan)
      reaches `Available` state. Confirmed under `services:` in the
      blueprint, NOT under `databases:`. Verify in the Render dashboard
      that `persistenceMode: journal-snapshot` (v6 — REDUCES but does
      NOT eliminate the risk of losing queued jobs on Redis restart) is
      set on the Key Value service, alongside `maxmemoryPolicy:
      noeviction` (preserved from v5).
5. - [ ] **`REDIS_URL` is available to the API** — verify in the Render
      dashboard → `vidiaforge-api` → Environment → `REDIS_URL` shows
      "From service: vidiaforge-redis" (NOT "From database"). The
      connection string starts with `redis://` (NO TLS — v6 correction:
      the INTERNAL Render-network connection string is `redis://`, NOT
      `rediss://`; the v5 doc incorrectly claimed it was `rediss://`).
6. - [ ] **`REDIS_URL` is available to the worker** — same check on the
      `vidiaforge-worker` service's Environment tab.
7. - [ ] **The API health check reports Redis connected** — `curl
      https://vidiaforge-api.onrender.com/api/health` returns
      `{"status":"ok","db":"connected","redis":"ok",...}` (or the
      equivalent shape produced by `src/lib/env-validation.ts` + the
      `/api/health` route).
8. - [ ] **The worker initializes its Redis-dependent queue** — the
      worker log shows `VIDIAFORGE WORKER READY` followed by BullMQ queue
      initialization (no `Redis connection failed` errors). The worker
      `/health` endpoint (port 3001, internal) reports redis ok.
9. - [ ] **The audio catalog returns real provider results** — `curl
      https://vidiaforge-api.onrender.com/api/audio/catalog?type=music`
      returns a non-empty `music` array (the default
      `AUDIO_PROVIDER=internet-archive` returns real CC-BY / CC-BY-SA /
      CC0 / Public Domain items from archive.org). The SFX sub-array is
      non-empty regardless (the 8 built-in SFX).
10. - [ ] **The Netlify API proxy reaches the actual Render API** — `curl
      https://vidiaforge.netlify.app/api/health` returns the same JSON
      as the direct Render call in step 7. Confirms the corrected
      `https://vidiaforge-api.onrender.com/api/:splat` proxy target.
11. - [ ] **Registration and login work** — visit `https://vidiaforge.netlify.app`,
      click "Sign in" → register a new user → land on the dashboard.
      Refresh the page → still on the dashboard (NOT signed out). This
      verifies the cookie-based session (`src/lib/auth.ts`) + the
      `SameSite=Lax` cookie + the same-origin `/api/*` proxy.
12. - [ ] **Project creation and persistence work** — click "New project"
      → select a template → click "Create from template" → the editor
      opens with the new project loaded (NOT "No project selected").
      Refresh the editor → the same project loads.
13. - [ ] **A real render job is enqueued and processed** — add at least
      one video clip + one audio clip to the timeline → click Export →
      the render job transitions from `queued` → `processing` →
      `completed` in the worker queue. The worker log shows the render
      job being picked up + ffmpeg invoked.
14. - [ ] **The exported media is available and valid** — download the
      rendered MP4 → `ffprobe output.mp4` shows an H.264 video stream +
      AAC audio stream + the expected duration. The download URL points
      to `STORAGE_PUBLIC_BASE_URL` (or a presigned bucket URL).
15. - [ ] **Node + Bun versions match the pinned versions (v6 + v7 + v8)** — verify
      in the Render API service deploy log:
      - Node version reported by Render is `v22.23.3` (v7: pinned via
        the `NODE_VERSION=22.11.0` env var on the API service —
        Render's #1 supported method per
        <https://render.com/docs/node-version>; belt-and-suspenders
        with `.node-version` at the repo root — the #2 supported
        method; both pin Node 22.11.0, no conflict. The v6
        `runtimeVersion: "22"` field was REMOVED in v7 — it was NOT
        a supported Render Blueprint field. v8: the pinned Node
        patch was updated from `22.11.0` to `22.23.3` — the latest
        22.x LTS patch as of 2026-10-10 (verified via
        <https://nodejs.org/dist/index.json>
        + <https://nodejs.org/en/about/previous-releases>); both
        `.node-version` + the `NODE_VERSION` env var were updated
        consistently in v8. If the Render dashboard still shows
        `runtimeVersion` on the API service, the deployment is
        running an outdated `render.yaml` — investigate before
        promoting to production. If the Render deploy log reports
        Node `v22.11.0` instead of `v22.23.3`, the deployment is
        running a pre-v8 `render.yaml` — investigate before
        promoting to production.)
      - Bun version reported by `bun install --frozen-lockfile` is
        `1.3.14` (matches `.bun-version` at the repo root + the
        `BUN_VERSION` env var on the API service — v8 did NOT
        change Bun).
      - The lockfile install shows "no changes" (i.e., the committed
        `bun.lock` was used as-is, no resolution drift).
16. - [ ] **The root `bun.lock` is present + used in the deployed build
      (v6, re-verified in v7 + v8)** — the v5 archive shipped without a root
      lockfile; v6 commits a 285KB `bun.lock` at the repo root. Verify
      in the Render deploy log that `bun install --frozen-lockfile` ran
      (NOT a fresh `bun install`) and that the package count matches
      what the v8 sandbox verified (890 packages, 0 drift, exit 0).
      If the deploy log shows "Resolving dependencies" instead of
      "Checked N installs across M packages (no changes)", the lockfile
      is being ignored — investigate before promoting to production.

### Per-feature verification (existing checklists)

The v3 file's per-feature checklists (Authentication, Create Project,
Templates panel, Audio library, Media upload, Sidebar scrolling,
Rendering) are reproduced here for reference. None were exercised in
the v8 sandbox — they all require a running PostgreSQL + Redis + S3
stack. They are still the authoritative manual verification steps for
the deployment engineer.

#### Authentication (Issue 4)

- [ ] Visit `https://vidiaforge.netlify.app` → landing page loads.
- [ ] Click "Sign in" → register a new user → land on dashboard.
- [ ] Refresh the page → still on dashboard (NOT signed out).
- [ ] Open a project → refresh → still in the editor with the same
      project loaded.
- [ ] (Optional) Simulate a backend outage by stopping the Render
      service for 30 seconds → refresh the page → see the
      "Connection issue" banner with a "Try again" button → user is
      NOT signed out → restart Render → click "Try again" → banner
      clears.
- [ ] Click the user menu → "Sign out" → land on the landing page →
      refresh → still signed out (no bounce-back).

#### Create Project (Issues 5 + 6)

- [ ] Click "New project" → the create-project dialog opens.
- [ ] Verify the Templates section shows real templates (with
      thumbnails) fetched from `/api/templates`.
- [ ] Click a template card → it shows a clear selected state
      (amber tint + checkmark badge).
- [ ] Click "Create from template" → the dialog closes → the editor
      opens with the new project loaded (NOT "No project selected").
- [ ] Verify exactly ONE project was created (check the dashboard).
- [ ] Refresh the editor → the same project loads.

#### Templates panel (Issues 2 + 7)

- [ ] Inside the editor, open the Templates sidebar panel → see the
      context banner "You are inside a project. Applying a template
      replaces the current timeline structure…".
- [ ] Verify each template card shows "Apply to current" (NOT "Use
      Template" — that label is for the dashboard context).
- [ ] Click "Apply to current" on a template → see the confirmation
      modal → click "Apply template" → the current project's timeline
      is replaced → the project ID stays the same (check the URL or
      the project metadata).
- [ ] Verify NO duplicate project was created (check the dashboard).
- [ ] Refresh the editor → the applied template persists.

#### Audio library (Issue 1 + v3 audio provider work)

- [ ] Open the Audio sidebar panel → Music sub-tab:
      - With `AUDIO_PROVIDER=internet-archive` (the v5 default): see
        real CC-licensed / public-domain tracks fetched live from
        archive.org (each with attribution per license).
      - With `AUDIO_PROVIDER=jamendo` + `JAMENDO_CLIENT_ID` set: see
        real Jamendo tracks (CC-BY / CC-BY-SA / CC0 only — CC-BY-NC /
        CC-BY-ND / unlicensed tracks are filtered out).
      - With `AUDIO_PROVIDER=none` (or unset): see the honest empty
        state "No music catalog configured" with a "Upload your audio"
        button (NOT fake sine-tone tracks labeled "Sunset Drive").
- [ ] Switch to the Sound FX sub-tab → see 8 real SFX (Whoosh,
      Impact Boom, Click, Pop, Camera Shutter, Crowd Cheer, Rain
      Ambience, Notification).
- [ ] Click Play on a SFX → real audio plays (the seek bar +
      duration display update from real metadata).
- [ ] Click Pause → playback stops.
- [ ] Click "+" (Add to timeline) on a SFX → a real audio clip is
      created on the timeline → save the project → refresh → the
      clip persists.

#### Media upload (Issue 4)

- [ ] Open the Media sidebar panel → drop in a real video file →
      upload succeeds → the asset appears in the library with a real
      thumbnail (after media-ingestion completes).
- [ ] Drop a file with an unsupported extension (e.g., `.txt`) → see
      a readable error toast like "Unsupported MIME type: text/plain.
      Allowed: video/mp4, video/quicktime, video/webm, audio/mpeg,
      audio/wav, audio/aac, audio/m4a, audio/ogg, image/jpeg,
      image/png, image/webp, image/gif." (NOT `[object Object]`).
- [ ] Drop a file larger than `MAX_UPLOAD_BYTES` → see "The file
      size we received does not match what was declared at upload
      time. Please retry the upload from the start." (NOT
      `[object Object]`).

#### Sidebar scrolling (Issue 8)

- [ ] Open the Sound FX sub-tab in the Audio panel (8 entries) →
      verify you can scroll to the last item (Notification) — the
      scrollbar is visible + usable.
- [ ] Open the Templates sidebar panel (13+ templates) → verify you
      can scroll to the last template.
- [ ] Resize the browser window to a short height → verify the
      sidebar scrolls independently of the editor canvas (the canvas
      does NOT scroll when the sidebar scrolls).
- [ ] Open the editor on a touch device → verify touch scrolling
      works in the sidebar.

#### Rendering (Issue 9)

- [ ] Create a project with at least one video clip + one audio
      clip → click Export → wait for the render to complete.
- [ ] Download the rendered MP4 → open it in a media player (or run
      `ffprobe output.mp4`) → verify:
  - The video stream is H.264 with the expected dimensions + frame
    rate.
  - The audio stream is present (the audio clip made it into the
    export).
  - The duration matches the timeline's computed duration.
- [ ] (Advanced) Create a project with a clip that has X-position
      keyframes (LEFT → CENTER → RIGHT) → export → inspect frames at
      the keyframe timestamps → verify the clip moves across the
      canvas (NOT stationary).

## 10. Unavailable credentials or services

The following were NOT available in the v8 repair sandbox and therefore
could NOT be exercised (same constraints as v5 + v6 + v7 — no
infrastructure access was added between v5, v6, v7, and v8):

- **No PostgreSQL** — the Prisma migrations could not be applied.
  `bun run db:migrate:deploy` was not run.
- **No Render Key Value (Redis)** — the worker could not be started. The
  render queue + media-ingestion queue paths were not exercised
  end-to-end. The `render-blueprint.test.ts` structural test confirms the
  blueprint declares the Redis resource correctly (35 tests, including
  the v6 `persistenceMode: journal-snapshot` check + the v7 `NODE_VERSION`
  + `runtimeVersion` ABSENT checks), but the live Redis connection +
  BullMQ queue operations were NOT verified. The v6
  `persistenceMode: journal-snapshot` declaration is NOT verified against
  a real Render Key Value instance — it is asserted by file inspection of
  `render.yaml` only.
- **No S3-compatible storage** — the storage provider was not exercised.
  The local-storage fallback is the only path tested (and only
  indirectly, via the thumbnail generator which writes to `public/`).
- **No `JAMENDO_CLIENT_ID` credential** — but this is NOT a blocker for
  v7: the default `AUDIO_PROVIDER=internet-archive` (explicitly set in
  `render.yaml`) needs no credentials. The Jamendo provider is implemented
  and unit-tested against recorded fixtures, but the live
  `https://api.jamendo.com/v3.0/tracks/` call path was not exercised.
  The credential is free, obtainable from
  <https://developer.jamendo.com/admin/apps>, and is only required if
  you switch `AUDIO_PROVIDER` from `internet-archive` to `jamendo`.
- **No Internet egress** — the Internet Archive live API call
  (`https://archive.org/advancedsearch.php` +
  `https://archive.org/metadata/{id}`) is BLOCKED in this sandbox. The
  Internet Archive provider is implemented and unit-tested against
  recorded fixtures (`tests/unit/audio-provider-contract.test.ts`), but
  the live call path was not exercised.
- **No deployment access** — neither Netlify nor Render credentials
  were available. No deploy was triggered, no logs were inspected, no
  live endpoints were curled. The v7 + v8 Node + Bun version pinning
  is verified by file inspection only (`.node-version` (now 22.23.3
  in v8, was 22.11.0 in v6/v7) + `.bun-version` (1.3.14) +
  `bun.lock` + `NODE_VERSION` env var (now 22.23.3 in v8, was
  22.11.0 in v7) + `BUN_VERSION` env var (1.3.14) in
  `render.yaml`); the live Render build log reporting Node `22.23.3`
  + Bun `1.3.14` is NOT verified.
- **No `DATABASE_URL`** — the production build (`bun run build`) was
  not run because Prisma generate requires a non-empty `DATABASE_URL`
  to be present at build time.
- **No Docker daemon** — the Docker build was NOT run. Both Dockerfiles
  were pinned to `oven/bun:1.3.14-alpine` (verified by file inspection +
  Docker Hub image-tag lookup — the image exists, last pushed
  2026-05-13, supports amd64 + arm64), but the actual `docker build` was
  not executed in the sandbox.

## Deployment readiness recommendation

The static checks that DID pass in the v8 repair sandbox:
typecheck **PASS** (0 errors), **399 unit tests PASS** (0 fail,
3021 `expect()` calls, 17 files), the `render-blueprint.test.ts`
structural test (35 tests, including the v7 `CHECK v6-7` correction,
preserved unchanged in v8) **PASS**, the `netlify-proxy.test.ts`
proxy-config test (8 tests) **PASS**, the `sfx-labeling.test.ts`
labeling test (12 tests) **PASS**, render smoke (2 pass, 1 skip)
**PASS**, keyframe production render E2E (1 pass) **PASS**, and the
v6 `bun install --frozen-lockfile` lockfile verification
(re-verified in v7 + v8 — 890 packages, 0 drift, exit 0) **PASS**.
**Lint FAIL/PARTIAL** — 7 pre-existing `react-hooks/set-state-in-effect`
errors in v2-era files (exit code 1, NOT newly introduced by v8).
The static checks that PASS are the strongest offline signal, but
lint is NOT a clean pass and must be reported honestly as FAIL
with 7 pre-existing errors. The infrastructure-dependent
verification (Netlify→Render routing, Render health, DB, Redis, S3,
production build, Docker build, audio provider live calls, full
E2E) is **NOT VERIFIED** and **BLOCKED** in this sandbox because no
PostgreSQL, Redis, S3, Docker daemon, deployment access, or
internet egress is available.

**Recommendation:** deploy to staging with a provisioned PostgreSQL +
Render Key Value (Redis) + S3-compatible bucket stack (via
`render blueprint deploy` using the v8-corrected `render.yaml` — the
v7 `runtimeVersion` removal + `NODE_VERSION` env var addition +
Dockerfile pinning are preserved, and the v8 Node.js patch update
22.11.0 → 22.23.3 is applied). Set the
`STORAGE_*` secrets + `JWT_SECRET` + `SESSION_SECRET` + `CORS_ORIGIN` in
the Render dashboard. The default `AUDIO_PROVIDER=internet-archive` is
already set — no credential needed for a non-empty music catalog. Be
aware that the `256mb` Key Value plan is Render's smallest PAID plan
(not free); review the Render pricing + the projected BullMQ queue size
before deploying — upgrade if production load exceeds the 256MB
envelope. Run the 16-step post-deployment checklist in §9 manually
against the deployed stack (the v6 additions are steps 15 + 16:
Node/Bun version verification + `bun.lock` presence check; the v7
updates to step 15 add an explicit check for the `NODE_VERSION` env
var + the absence of `runtimeVersion`; the v8 update to step 15
updates the expected Node version from `22.11.0` to `22.23.3`; the v7 Dockerfile pinning is
reflected in §3 step 2), then promote to production once all 16 steps
pass.
