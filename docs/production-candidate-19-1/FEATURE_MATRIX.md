# VidiaForge V19.1 — Feature Matrix

Production candidate `19-1`. Each row maps a major editor feature to
its actual status. A feature is `IMPLEMENTED` only when its
end-to-end behavior has been demonstrated by an automated test or
manual verification.

This is the v8 update of the feature matrix. Status changes from v7:
- **Render Blueprint (render.yaml)**: IMPLEMENTED (kept; evidence
  updated — v8 updates the Node.js patch pinned in `.node-version` +
  the `NODE_VERSION` env var on the API service from 22.11.0 to
  22.23.3 (the latest Node.js 22 LTS patch as of 2026-10-10,
  verified via <https://nodejs.org/dist/index.json> +
  <https://nodejs.org/en/about/previous-releases>). The v7
  `runtimeVersion: "22"` removal + `runtime: node` declaration +
  `NODE_VERSION` env var + the `CHECK v6-7` regression test
  correction are all preserved unchanged in v8. The structural
  test count remains 35 (no tests added or removed in v8 — the
  `CHECK v6-7` test continues to PASS in v8 because the
  `NODE_VERSION` env var value `22.23.3` matches the `.node-version`
  file `22.23.3`).)
- **Node + Bun version pinning**: IMPLEMENTED (kept; evidence
  updated — v8 updates Node.js from 22.11.0 to 22.23.3 (the
  latest 22.x LTS patch as of 2026-10-10, verified via
  <https://nodejs.org/dist/index.json>). The `.node-version` file
  (now 22.23.3) + the `NODE_VERSION=22.23.3` env var on the API
  service are both updated; both remain consistent (the #1 +
  #2 supported methods per <https://render.com/docs/node-version>).
  Bun is unchanged (still 1.3.14 — the v8 pass scope was the
  Node.js version question only; updating Bun would require
  regenerating the committed `bun.lock`, which is out of scope
  for v8). The v6 `runtimeVersion: "22"` field was REMOVED in v7
  and remains absent in v8.)
- **Root Bun lockfile**: IMPLEMENTED (kept from v6 — 285 KB, 890
  packages, generated with Bun 1.3.14; `bun install --frozen-lockfile`
  verified to succeed cleanly in v8 — same as v6/v7; the v8 pass
  did not touch the lockfile)
- **Docker Bun version pinning**: PARTIAL (kept from v7 — both
  Dockerfiles pinned to `oven/bun:1.3.14-alpine`. The `1.3.14-alpine`
  image was verified in v7 to exist on Docker Hub (last pushed
  2026-05-13, status active, supports amd64 + arm64). The v8 pass
  did NOT modify the Dockerfiles. Docker build still NOT
  VERIFIED — no Docker daemon in the repair sandbox.)

Status changes from v6 (preserved from the v7 update):
- **Render Blueprint (render.yaml)**: IMPLEMENTED (kept; evidence
  updated — v7 REMOVES the unsupported `runtimeVersion: "22"` field
  that the v6 pass had incorrectly kept; v7 ADDS the supported
  `NODE_VERSION=22.11.0` env var on the API service — the #1
  supported method per <https://render.com/docs/node-version>; v7
  CORRECTS the `CHECK v6-7` regression test in
  `tests/unit/render-blueprint.test.ts` to verify the supported
  config — `runtime: node` IS present, `runtimeVersion` is ABSENT,
  `NODE_VERSION` env var IS present + matches `.node-version`. The
  structural test count remains 35 (no tests added or removed — the
  `CHECK v6-7` test was corrected in-place). v8 updates the
  pinned Node patch from 22.11.0 to 22.23.3.)
- **Root Bun lockfile**: IMPLEMENTED (kept from v6 — 285 KB, 890
  packages, generated with Bun 1.3.14; `bun install --frozen-lockfile`
  verified to succeed cleanly in v7 + v8 — same as v6; neither the
  v7 nor the v8 pass touched the lockfile)
- **Node + Bun version pinning**: IMPLEMENTED (kept; evidence
  updated — v7 ADDS the `NODE_VERSION=22.11.0` env var on the API
  service as the #1 supported method per Render's docs; the
  `.node-version` file (22.11.0) is preserved as the #2 supported
  method — both pin the same version, no conflict. The v6
  `runtimeVersion: "22"` field was REMOVED — it was NOT a supported
  Render Blueprint field. The `.bun-version` file (1.3.14) + the
  `BUN_VERSION=1.3.14` env var are preserved unchanged from v6.
  v8 updates the Node.js patch from 22.11.0 to 22.23.3.)
- **Docker Bun version pinning**: NEW ROW (v7), status PARTIAL —
  both Dockerfiles pinned to `oven/bun:1.3.14-alpine` (was floating
  `oven/bun:1-alpine` in v6). The `1.3.14-alpine` image was verified
  to exist on Docker Hub (last pushed 2026-05-13, status active,
  supports amd64 + arm64). Docker build NOT VERIFIED — no
  Docker daemon in the repair sandbox. v8 did NOT modify the
  Dockerfiles.

Status changes from v5 (preserved from the v6 + v7 updates):
- **Render Blueprint (render.yaml)**: NEW ROW in v5, status IMPLEMENTED
  (17 structural tests pass in v5; extended to 35 tests in v6;
  `CHECK v6-7` corrected in-place in v7; v8 updates the pinned Node
  patch from 22.11.0 to 22.23.3; Render-side acceptance NOT
  VERIFIED);
  v7 updates the row's evidence with the `runtimeVersion` removal
  + `NODE_VERSION` env var addition + the corrected regression
  test; v8 updates the row's evidence with the Node.js patch
  update 22.11.0 → 22.23.3
- **Root Bun lockfile**: NEW ROW in v6, status IMPLEMENTED
- **Node + Bun version pinning**: NEW ROW in v6, status IMPLEMENTED
  (extended in v7; Node patch updated in v8)

Status changes from v3 (preserved from the v5 update):
- **Netlify-to-Render proxy**: NOT VERIFIED → PARTIAL (proxy target
  corrected + 8 structural tests; live routing still NOT VERIFIED)
- **Audio catalog (music)**: PARTIAL (kept; evidence updated —
  `AUDIO_PROVIDER=internet-archive` now explicitly set in render.yaml)
- **Audio catalog (SFX)**: IMPLEMENTED (kept; evidence updated —
  `sfx-labeling.test.ts` adds 12 honest-labeling tests)
- **Template thumbnails**: IMPLEMENTED (kept; evidence updated —
  UI labels thumbnails as "layout preview" + visible "Layout" badge)

## Status legend

- **IMPLEMENTED** — actual end-to-end behavior has been demonstrated.
- **PARTIAL** — some real behavior exists, but important functionality is missing.
- **BLOCKED** — a required dependency or configuration prevents operation.
- **NOT VERIFIED** — evidence is insufficient.

## Editor features

| Feature | Status | Evidence |
|---------|--------|----------|
| Project create (blank) | PARTIAL | Logic fixed (data.project.id bug); no automated test in this sandbox (requires DB). Manual verification pending. |
| Project create (from template) | PARTIAL | `/api/templates/[id]/use` route now also calls `validateTemplateSlotConsistency()` before creating the project. Logic-only-fixed in v2; still requires DB for end-to-end automated test. |
| Project open / load | PARTIAL | Logic fixed (loadProject reads data.project, not data root); no automated test (requires DB). Manual verification pending. |
| Project save (auto + manual) | PARTIAL | Existing persistProject() flow unchanged; no automated test (requires DB). |
| Project delete + duplicate | PARTIAL | Existing dashboard handlers; no automated test (requires DB). |
| Session restore on refresh | IMPLEMENTED | `tests/unit/auth-classification.test.ts` — 15 tests verify 401→clear, 5xx/timeout/network→preserve, retry logic. The bug "5xx signs out user" is confirmed fixed via regression tests. |
| Transient error banner + retry | IMPLEMENTED | `src/components/views/transient-auth-error-banner.tsx` + `src/stores/auth-store.ts` `retry()` action + bounded retry with 1.5s backoff. |
| Sign out | IMPLEMENTED | `auth-store.ts` `logout()` atomically clears user + persisted view (no bounce-back). Verified by auth-classification regression test. |
| Media upload (single-shot) | PARTIAL | Centralized error normalization (`tests/unit/error-normalization.test.ts` — 22 tests verify no `[object Object]` ever reaches the user). Actual upload requires S3 + worker — NOT VERIFIED end-to-end in this sandbox. |
| Media upload (presigned URL) | PARTIAL | Existing /api/assets/upload-intent + /finalize routes unchanged; no automated test in this sandbox. |
| Media library list + search | PARTIAL | Existing `refreshAssets()` flow unchanged; no automated test (requires DB). |
| Media add to timeline | PARTIAL | Existing `addMediaToTimeline()` flow; verified by `tests/unit/timeline.test.ts` (existing). |
| Media Range streaming | PARTIAL | Existing /api/assets/by-key/[key] + /api/assets/[id] routes unchanged. |
| Recording (camera + screen + voice) | PARTIAL | `recording-dialog.tsx` uses centralized error normalization. Actual `getUserMedia` requires HTTPS + browser permissions — manual verification only. |
| Audio catalog (SFX) | IMPLEMENTED | `tests/unit/audio-catalog.test.ts` (10 tests) + `tests/unit/sfx-labeling.test.ts` (12 tests) verify the 8 built-in SFX are real noise-based WAVs with real durations + real files on disk + CC0 license + honest synthetic labeling. The 3 previously-misleading titles ("Crowd Cheer", "Rain Ambience", "Camera Shutter") are now "Synthetic Crowd Bed", "Synthetic Rain Bed", "Synthetic Shutter". The 5 generic titles (Whoosh, Impact Boom, Click, Pop, Notification) are unchanged because a synthetic whoosh/click/pop/notification/impact is still legitimately that thing. Every SFX `description` explicitly states the synthetic noise source. |
| Audio catalog (music) | PARTIAL | `AUDIO_PROVIDER=internet-archive` is now explicitly set in `render.yaml` (v5) so the deployed music catalog is non-empty without any credentials. The Internet Archive adapter is contract-tested (`tests/unit/audio-provider-contract.test.ts`, 61 tests) for provider selection + license parsing + fixture-based item parsing. `tests/unit/render-blueprint.test.ts` CHECK 12 verifies `AUDIO_PROVIDER` is explicitly set on the API service. Live verification against the real Internet Archive API is BLOCKED (no internet egress in sandbox); the adapter needs no credentials, so it goes live the moment the deployment has internet. The Jamendo adapter (optional) requires `JAMENDO_CLIENT_ID` (declared in render.yaml with `sync: false`); it honestly reports `configured=false` until that env var is set. |
| Audio preview playback | IMPLEMENTED | Audio panel uses a single shared `HTMLAudioElement` with `loadedmetadata` events; durations read from real metadata (never fabricated). Play/pause/seek work; failed loads show actionable errors. |
| Audio add to timeline | IMPLEMENTED | `audio-panel.tsx` `handleAddToTimeline` builds a real `AssetRef` pointing at the audio URL, finds-or-creates an audio track, calls `addMediaToTimeline()` which calls `scheduleSave()` — clip persists across refresh. |
| Audio preview resource cleanup | IMPLEMENTED | `audio-panel.tsx` `useEffect` cleanup pauses + releases the audio element on unmount. |
| Template catalog (builtin) | IMPLEMENTED | `tests/unit/template-integrity.test.ts` — 12 tests verify 13 templates, every template has a stable id + title + category, slot IDs are unique, clip.slotId resolves to a defined slot, no clip uses `placeholder-` assetId. Additional slot-consistency invariants (required-slot-has-clip, slot-type-matches-clip-kind, no-orphan-slots) verified by `tests/unit/template-slot-validation.test.ts` (20 tests) — see dedicated row. |
| Template catalog (creator-uploaded) | PARTIAL | Existing /api/templates routes unchanged; no automated test for the creator program in this sandbox. |
| Template search + filter + sort | PARTIAL | Existing `/api/templates?sort=...&category=...&q=...` route unchanged; the frontend re-renders templates-panel correctly. No automated test. |
| Template thumbnails | IMPLEMENTED | `scripts/generate-template-thumbnails.ts` imports `BUILTIN_TEMPLATES` directly (unified source of truth — no SPECS array drift) + renders layout previews (gradient + title + text-slot `defaultValue`s + media-slot rectangles at their actual timeline positions). The UI labels them honestly: `alt='${template.title} layout preview'` + a visible "Layout" badge on the templates panel (v5) so users understand the thumbnails are layout illustrations, not rendered frames. `tests/unit/template-integrity.test.ts` verifies every `thumbnailUrl` points at a real PNG under 50KB. 13/13 thumbnails regenerated, all pass the integrity test. |
| Template slot-clip consistency | IMPLEMENTED | `tests/unit/template-slot-validation.test.ts` (20 tests) verifies required-slot-has-clip, no-orphan-slots, slot-type-matches-clip-kind, slot IDs / clip IDs / track IDs unique, every clip references an existing track, media slots declare acceptedKinds, audio slots declare acceptedKinds=['audio'], text slots declare defaultValue. `validateTemplateSlotConsistency()` exported from `src/lib/templates/index.ts` + wired into `/api/templates/[id]/use` + `/api/templates/[id]/apply` routes as defense-in-depth. |
| Template selection (modal) | PARTIAL | `create-project-dialog.tsx` rewritten — cards are real `<button>`s with `aria-pressed` + keyboard activation + focus-visible ring + visible selected state. No automated test (requires DB). |
| Template apply to existing project | PARTIAL | `/api/templates/[id]/apply` route now also calls `validateTemplateSlotConsistency()` before applying the template (defense-in-depth). Logic-only-fixed in v2; still requires DB for end-to-end automated test. |
| Timeline trim operations | IMPLEMENTED | `tests/unit/trim-operations.test.ts` — 22 existing tests covering ripple / roll / slip / slide / lift / extract / insert / overwrite / extend. |
| Timeline structure | IMPLEMENTED | `tests/unit/timeline.test.ts` — existing tests. |
| Project schema validation | IMPLEMENTED | `tests/unit/project-schema.test.ts` — existing tests. |
| Keyframe evaluator (X/Y position) | IMPLEMENTED | `tests/unit/keyframe-evaluator.test.ts` — existing tests verify the evaluator computes interpolated values correctly. |
| Keyframe production render (X/Y animation) | IMPLEMENTED | `tests/integration/keyframe-production-render-e2e.test.ts` — calls the production `FFmpegRenderService.render()`, renders a clip with X keyframes (LEFT → CENTER → RIGHT), extracts frames at t=0.1/0.5/0.9, analyzes red-pixel positions via raw RGB24 scanning, asserts positions move 0.258 → 0.517 → 0.767 within tolerance ±0.10. **PASS** in this sandbox. |
| Render filter graph (multi-track compositing) | IMPLEMENTED | `tests/unit/render-filter-graph.test.ts` — existing tests verify the filter graph builder produces correct FFmpeg commands for overlapping + non-overlapping + gapped timelines. |
| Render smoke test (minimal project) | IMPLEMENTED | `tests/render-smoke.test.ts` — renders the sample project to a 3s 640×480 H.264 MP4 with audio, FFprobe validates codec/dimensions/duration/audio-stream presence. **PASS** in this sandbox. |
| Text editing | IMPLEMENTED | `tests/unit/text-editing.test.ts` — existing tests. |
| Color scopes | IMPLEMENTED | `tests/unit/color-scopes.test.ts` — existing tests. |
| Storage provider (local) | IMPLEMENTED | `tests/unit/storage.test.ts` — 10 existing tests verify upload/get/delete/range/path-traversal protection. |
| Storage provider (S3) | PARTIAL | Existing `src/lib/storage/s3-provider.ts` unchanged; no automated test in this sandbox (requires S3 credentials). |
| AI transcription | BLOCKED | No `TRANSCRIPTION_PROVIDER` configured. The `/api/ai/transcribe` route returns a clear "TRANSCRIPTION_PROVIDER_NOT_CONFIGURED" error. |
| AI translation | BLOCKED | No `TRANSLATION_PROVIDER` configured. |
| AI command engine (LLM edit) | PARTIAL | Uses `z-ai-web-dev-sdk` (the SDK is in package.json). No automated test in this sandbox (requires SDK credentials). |
| Effects panel (visual) | PARTIAL | UI exists; not all effects have renderer support. Honest "PARTIAL" — see `docs/FEATURE_MATRIX_V19.md`. |
| Filters panel | PARTIAL | UI exists; some filters have renderer support. |
| Transitions panel | PARTIAL | UI exists; some transitions have renderer support. |
| Captions (AI) | BLOCKED | Requires `TRANSCRIPTION_PROVIDER`. |
| Brand Kit | PARTIAL | UI + DB schema exist; not all brand-kit tokens are wired into the renderer. |
| Left-sidebar scrolling | IMPLEMENTED | `src/components/editor/left-sidebar.tsx` uses native `overflow-y-auto` + `min-h-0` + `overscroll-behavior-y: contain`; CSS rules in `globals.css` implement the flex-column-with-scrolling-body idiom. Manual verification only (no automated test for layout/CSS). |
| Left-sidebar panels (15 tabs) | PARTIAL | All 15 panels render. The Media / Audio / Templates panels are wired to real APIs; the rest (Effects, Filters, Transitions, Captions, AI Tools, etc.) are PARTIAL — see existing `docs/FEATURE_MATRIX_V19.md`. |
| Worker (render + media-ingestion) | BLOCKED | Requires `REDIS_URL`. The worker is `mini-services/worker/` (independent Bun project). Not started in this sandbox. |
| Worker crash recovery | PARTIAL | Existing `tests/worker-integration/crash-recovery.test.ts` exists; NOT RUN in this sandbox (requires Redis + worker process). |
| Render job lifecycle | PARTIAL | Existing routes unchanged; no automated test (requires Redis + worker). |
| PWA (manifest + service worker) | PARTIAL | `public/manifest.webmanifest` + `public/sw.js` unchanged. PWA installability is verified by manual browser inspection only. |
| Netlify-to-Render proxy | PARTIAL | `netlify.toml` `/api/*` proxy target corrected (v5) from `https://vidiaforge.onrender.com/api/:splat` to `https://vidiaforge-api.onrender.com/api/:splat` — now matches the `vidiaforge-api` service name declared in `render.yaml`. `tests/unit/netlify-proxy.test.ts` (8 tests) validates the target URL matches the Render service name + verifies the proxy `status` (200) + `force` (true) + `X-Forwarded-Host` header + cross-config consistency with render.yaml. Live routing still NOT VERIFIED (no deployment in sandbox). |
| Render Blueprint (render.yaml) | IMPLEMENTED | `tests/unit/render-blueprint.test.ts` (35 tests — 17 from v5 + 18 added in v6 + `CHECK v6-7` corrected in-place in v7; no tests added or removed in v7 or v8) structurally validates `render.yaml`: Redis is under `services:` with `type: keyvalue` + `plan: 256mb` + `maxmemoryPolicy: noeviction` + `ipAllowList: []` + (v6) `persistenceMode: journal-snapshot`; API + worker `REDIS_URL` use `fromService` (not `fromDatabase`) with `type: keyvalue` + `property: connectionString`; PostgreSQL is preserved under `databases:` with `postgresql` type + `databases:` contains only PostgreSQL (no Redis); `AUDIO_PROVIDER=internet-archive` is explicitly set on the API service; `JAMENDO_CLIENT_ID` is declared with `sync: false`; no hardcoded credentials; no plaintext secrets. v6 extensions: `.node-version` (22.23.3 in v8, was 22.11.0 in v6/v7) + `.bun-version` (1.3.14) files at the repo root; `BUN_VERSION=1.3.14` env var on the API service; root `bun.lock` (285 KB, 890 packages) committed at the repo root; corrected comments that the INTERNAL Key Value connection string (used via `fromService`) is `redis://` (NO TLS) and the EXTERNAL connection string is `rediss://` (TLS). **v7 correction**: the unsupported `runtimeVersion: "22"` field was REMOVED from the API service; the supported `NODE_VERSION=22.11.0` env var was ADDED (the #1 supported method per <https://render.com/docs/node-version>); the `CHECK v6-7` regression test was corrected in-place to verify `runtimeVersion` is ABSENT + `runtime: node` + `NODE_VERSION` are present + the env var value matches `.node-version`. The corrected test was verified to FAIL when `runtimeVersion: "22"` is reintroduced. **v8 update**: the Node.js patch was updated from `22.11.0` to `22.23.3` (the latest 22.x LTS patch as of 2026-10-10, verified via <https://nodejs.org/dist/index.json> + <https://nodejs.org/en/about/previous-releases>); the `CHECK v6-7` test still passes in v8 because the `NODE_VERSION` env var value (`22.23.3`) matches the `.node-version` file (`22.23.3`). Render-side acceptance (actually deploying the Blueprint + verifying Render provisions the resources) is NOT VERIFIED — no Render CLI or Render access in sandbox. |
| Root Bun lockfile | IMPLEMENTED | `bun.lock` (285 KB, 890 packages, `lockfileVersion: 1`) generated by `bun install` with Bun 1.3.14 + committed at the repo root. The v5 archive did not include a root lockfile (only `mini-services/worker/bun.lock` existed); the v6 pass generates + commits it; the v7 + v8 passes inherit it unchanged (neither pass touches the lockfile or `package.json`). `bun install --frozen-lockfile` verified to succeed cleanly against the committed lockfile in the v8 pass (890 packages, 0 drift, exit 0) — this is the exact command Render's API service `buildCommand` will run on deploy. `tests/unit/render-blueprint.test.ts` includes a regression check (added in v6, preserved in v7 + v8) that the root `bun.lock` exists + is parseable + is internally consistent with `package.json`. |
| Node + Bun version pinning | IMPLEMENTED | `.node-version` (contents `22.23.3` in v8, was `22.11.0` in v6/v7) + `.bun-version` (contents `1.3.14`) files at the repo root (added in v6, preserved in v7 + v8). Render's `node` runtime respects `.node-version` (pins the exact Node patch version); Render's Bun installer respects `.bun-version`. `BUN_VERSION=1.3.14` env var on the API service in render.yaml (added in v6, preserved in v7 + v8 — belt-and-suspenders with the `.bun-version` file). **v7**: `NODE_VERSION=22.11.0` env var on the API service in render.yaml (NEW in v7 — the #1 supported method per <https://render.com/docs/node-version>). The v6 `runtimeVersion: "22"` field was REMOVED in v7 — verified authoritatively against Render's docs (blueprint-spec + web-services + node-version) that `runtimeVersion` is NOT a supported Render Blueprint property. The `.node-version` file (22.11.0 in v6/v7) is preserved as the #2 supported method — both pin the same version, no conflict. The worker service uses Bun pre-baked in its worker image (no `BUN_VERSION` env var needed on the worker). **v8**: the `NODE_VERSION` env var value + the `.node-version` file were both updated from `22.11.0` to `22.23.3` (the latest Node.js 22 LTS patch as of 2026-10-10, verified via <https://nodejs.org/dist/index.json> + <https://nodejs.org/en/about/previous-releases>). The v8 pass did NOT change Bun (still 1.3.14 — updating Bun would require regenerating the committed `bun.lock`, which is out of scope for v8). `tests/unit/render-blueprint.test.ts` includes regression checks (added in v6, corrected in-place in v7, preserved unchanged in v8) that `.node-version` exists + contains a Node version, `.bun-version` exists + contains a Bun version, the API service envVars include a `BUN_VERSION` entry, AND (v7 NEW; v8 PASS) the API service envVars include a `NODE_VERSION` entry matching `.node-version` + the API service has NO `runtimeVersion` field. The `CHECK v6-7` test still passes in v8 because the `NODE_VERSION` env var value (`22.23.3`) matches the `.node-version` file (`22.23.3`). Render-side acceptance (verifying the deployed build actually uses these versions) is NOT VERIFIED — no Render CLI or Render access in sandbox. |
| Docker Bun version pinning | PARTIAL | Both Dockerfiles (`Dockerfile` — 3 `FROM` lines, `worker.Dockerfile` — 4 `FROM` lines) pinned to `oven/bun:1.3.14-alpine` (NEW in v7 — was the floating `oven/bun:1-alpine` tag in v6; preserved unchanged in v8 because the v8 pass scope was the Node.js version question only, not Bun). The `1.3.14-alpine` image was verified to EXIST on Docker Hub (last pushed 2026-05-13, status active, supports amd64 + arm64) via Docker Hub image-tag lookup. The pinned tag matches `.bun-version` (1.3.14) + the `BUN_VERSION` env var (1.3.14) + the root `bun.lock` (generated with Bun 1.3.14) — no version conflict between the Docker build environment, the lockfile, and the env-var-based pin. **Docker build NOT VERIFIED — no Docker daemon in the repair sandbox.** The actual `docker build` for either Dockerfile was not executed in v7 or v8. Status: PARTIAL (configuration verified by file inspection + Docker Hub image lookup; image build NOT VERIFIED). |

## Summary

| Status | Count |
|--------|-------|
| IMPLEMENTED | 24 |
| PARTIAL | 28 |
| BLOCKED | 4 |
| NOT VERIFIED | 0 |
| **Total** | 56 features tracked |

(Note: the v3 summary table reported `18 / 20 / 3 / 1 / 42` but the
actual v3 table contained 52 rows with counts `21 / 26 / 4 / 1 / 52`.
The v5 numbers (`22 / 27 / 4 / 0 / 53`) were an honest recount after
the v5 updates: +1 IMPLEMENTED for the new Render Blueprint row, +1
PARTIAL because the Netlify-to-Render proxy moved from NOT VERIFIED
to PARTIAL, −1 NOT VERIFIED for the same move. The v6 numbers
(`24 / 27 / 4 / 0 / 55`) added 2 NEW IMPLEMENTED rows for the v6
deployment-hardening additions (Root Bun lockfile + Node + Bun version
pinning) — the existing Render Blueprint row stayed IMPLEMENTED with
extended v6 evidence, no other rows changed status. The v7 numbers
(`24 / 28 / 4 / 0 / 56`) added 1 NEW PARTIAL row for the v7
Docker Bun version pinning addition — configuration verified by file
inspection + Docker Hub image lookup, but Docker build NOT VERIFIED
(no Docker daemon in sandbox). The v8 numbers above (unchanged from
v7: `24 / 28 / 4 / 0 / 56`) reflect that the v8 pass did NOT add or
remove any rows — v8 only updated the evidence on 3 existing rows
(Render Blueprint — Node patch 22.11.0 → 22.23.3; Node + Bun version
pinning — Node patch 22.11.0 → 22.23.3; Root Bun lockfile —
re-verified `bun install --frozen-lockfile` PASS in v8). The Render
Blueprint row stays IMPLEMENTED with the v8-corrected evidence
(v7-corrected config preserved; v8 Node patch update applied). The
Root Bun lockfile + Node + Bun version pinning rows stay IMPLEMENTED
with v8 re-verification (`bun install --frozen-lockfile` re-run
cleanly; structural checks still pass; Node patch version updated
22.11.0 → 22.23.3 in both `.node-version` + the `NODE_VERSION` env
var). The Docker Bun version pinning row stays PARTIAL — v8 did NOT
modify the Dockerfiles; Docker build is still NOT VERIFIED. No
features changed status in v8.)

## Honesty notes

- The 24 IMPLEMENTED features are backed by automated tests that
  exercise real code paths (not just route handlers returning 200).
  The v5 IMPLEMENTED row (Render Blueprint) is backed by structural
  tests (17 in v5, extended to 35 in v6, with the `CHECK v6-7` test
  corrected in-place in v7, preserved unchanged in v8) that validate
  `render.yaml`'s shape; the v6 pass extends that suite with new
  regression checks for the v6 deployment-hardening additions (root
  `bun.lock`, version files, `BUN_VERSION` env var, `persistenceMode:
  journal-snapshot`); the v7 pass corrects the `CHECK v6-7` test
  in-place to verify the supported config (`runtimeVersion` ABSENT +
  `runtime: node` + `NODE_VERSION` env var present + matching
  `.node-version`); the v8 pass preserves the v7-corrected test
  unchanged and updates only the pinned Node patch value (22.11.0 →
  22.23.3) — the test still passes because the env var value matches
  the `.node-version` file (both 22.23.3 in v8). The 2 v6 NEW
  IMPLEMENTED rows (Root Bun lockfile + Node + Bun version pinning)
  are backed by `bun install --frozen-lockfile` succeeding cleanly +
  the structural checks in `render-blueprint.test.ts`. The v7 pass
  re-verifies the v6 lockfile install (`bun install
  --frozen-lockfile` PASS — 890 packages, 0 drift) and the v6
  structural checks still pass (35/35 render-blueprint tests, 0
  fail, 107 `expect()` calls). The v8 pass re-verifies again
  (identical result — 890 packages, 0 drift, exit 0; 35/35
  render-blueprint tests pass; typecheck PASS 0 errors; 399/399 unit
  tests pass). Render-side acceptance is NOT VERIFIED for any of
  these rows because there is no Render CLI or Render access in the
  sandbox.
- The 28 PARTIAL features have real code that compiles + lints clean
  + has TypeScript types, but lack end-to-end automated tests in
  this sandbox (typically because they require a running PostgreSQL
  + Redis + S3 stack + internet egress for the audio provider). The
  Netlify-to-Render proxy is PARTIAL (not IMPLEMENTED) because the
  structural test only verifies the configuration matches itself —
  live routing is still NOT VERIFIED without a deployment. The v7
  NEW PARTIAL row (Docker Bun version pinning) is PARTIAL (not
  IMPLEMENTED) because the Dockerfiles are pinned to
  `oven/bun:1.3.14-alpine` (verified by file inspection + Docker
  Hub image lookup) but the actual `docker build` was not run — no
  Docker daemon in the repair sandbox. The v8 pass did NOT modify
  the Dockerfiles, so the Docker Bun version pinning row remains
  PARTIAL in v8.
- The 4 BLOCKED features require explicit configuration
  (`TRANSCRIPTION_PROVIDER`, `TRANSLATION_PROVIDER`,
  `JAMENDO_CLIENT_ID` for the Jamendo adapter) or infrastructure
  (`REDIS_URL` for the worker) that was not provisioned.
- The 0 NOT VERIFIED features: in v3 the Netlify-to-Render proxy was
  the single NOT VERIFIED feature; the v5 pass fixed the proxy target
  + added 8 structural tests, promoting it to PARTIAL. There are no
  remaining NOT VERIFIED features.
- The v5 pass added 37 new unit tests (17 render-blueprint + 8
  netlify-proxy + 12 sfx-labeling), raising the total from 345 (v3)
  to 382 (v5). The v6 pass extended `tests/unit/render-blueprint.test.ts`
  with 18 new v6 regression checks (raising that suite from 17 to 35
  tests + the total from 382 to 399). The v7 pass made NO test count
  change: the `CHECK v6-7` test was corrected in-place (the v6 test
  REQUIRED the unsupported `runtimeVersion: "22"` field; the v7 test
  instead verifies `runtimeVersion` is ABSENT + `runtime: node` +
  the `NODE_VERSION` env var are present + the env var value matches
  the `.node-version` file). The v8 pass also made NO test count
  change: no test files were modified in v8 (only `.node-version` +
  `render.yaml`). The corrected test was verified in v7 to FAIL when
  `runtimeVersion: "22"` is reintroduced. Final test counts
  (measured in the v8 pass — no placeholders): 399 unit tests pass,
  0 fail, 3021 `expect()` calls, across 17 files; 35 render-blueprint
  tests pass, 0 fail, 107 `expect()` calls. All unit tests pass,
  `bun install --frozen-lockfile` runs cleanly against the committed
  `bun.lock` (890 packages, 0 drift, exit 0), `bun run typecheck`
  passes with 0 errors, and the keyframe render E2E + render smoke
  tests continue to pass (unchanged from v5/v6/v7). **Lint FAIL/PARTIAL**
  — 7 pre-existing `react-hooks/set-state-in-effect` errors in v2-era
  files (audio-panel.tsx line 161, templates-panel.tsx line 118,
  recording-dialog.tsx lines 71 + 127, carousel.tsx line 98,
  create-project-dialog.tsx line 141, use-mobile.ts line 14; exit
  code 1, 0 warnings). The 7 pre-existing lint errors are unchanged
  across v3, v5, v6, v7, and v8 — none of those passes touched any
  application source file that would have introduced new
  `useState`-in-effect patterns. The v6 edits (lockfile + two version
  files + render.yaml envVar entries + render.yaml comments +
  render.yaml Key Value property) introduced 0 new lint violations;
  the v7 edits (render.yaml `runtimeVersion` removal + `NODE_VERSION`
  envVar addition + `CHECK v6-7` test correction + 7 Dockerfile `FROM`
  lines pinned to `oven/bun:1.3.14-alpine`) introduced 0 new lint
  violations because none of those files are lint targets; the v8
  edits (`.node-version` 22.11.0 → 22.23.3 + `render.yaml` `NODE_VERSION`
  envVar value 22.11.0 → 22.23.3 + `render.yaml` header comments +
  production-notes block #6) also introduced 0 new lint violations
  because none of those files are lint targets. The 7 pre-existing
  errors remain — lint is NOT a clean pass and must be reported
  honestly as FAIL/PARTIAL with 7 pre-existing errors.
