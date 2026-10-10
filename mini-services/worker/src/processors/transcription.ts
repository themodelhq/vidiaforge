// VidiaForge Worker — transcription processor
// V11.1: Durable AIJob lease with persisted workerId/attemptId/heartbeatAt.
//
// Lifecycle:
//   1. Atomic claim: queued → processing, persist workerId + attemptId + attempt++
//   2. Heartbeat: update heartbeatAt every AI_JOB_HEARTBEAT_MS (ownership-guarded)
//   3. Authorization: verify AIJob.userId === Project.userId === Asset.userId
//   4. Storage validation: HeadObject → size check
//   5. Stream media to temp file (no buffering)
//   6. Provider transcription with timeout
//   7. Deterministic transcription identity (SHA-256)
//   8. TRANSACTION: apply captions + mark completed (ownership-guarded)
//   9. Cleanup: temp dir + heartbeat timer in finally

import { PrismaClient } from '@prisma/client';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

// V17.1 §9: Deterministic test hold — file-based barrier used by the
// integration test to pause the processor at a known point AFTER claim +
// heartbeat but BEFORE completion. FAIL CLOSED — only active when
// NODE_ENV=test AND AIJOB_TEST_HOLD=true. See mini-services/worker/src/test-hold.ts.
import { isTestHoldActive, waitForHoldRelease, cleanup as cleanupTestHold } from '../test-hold';

const lib = '../../../../src/lib';

const MAX_TRANSCRIPTION_FILE_BYTES = parseInt(
  process.env.MAX_TRANSCRIPTION_FILE_BYTES || String(500 * 1024 * 1024),
  10
);

const TRANSCRIPTION_TIMEOUT_MS = parseInt(
  process.env.TRANSCRIPTION_TIMEOUT_MS || String(10 * 60 * 1000),
  10
);

// V11.1 §18-19: Lease + heartbeat configuration
const AI_JOB_LEASE_MS = parseInt(
  process.env.AI_JOB_LEASE_MS || String(120_000), // 2 min lease
  10
);
const AI_JOB_HEARTBEAT_MS = parseInt(
  process.env.AI_JOB_HEARTBEAT_MS || String(30_000), // 30s heartbeat
  10
);

// V11.1 §12: Stable worker identity for the process lifetime
const WORKER_ID = process.env.WORKER_ID || `worker-${randomUUID()}`;

export async function processTranscription(job: any): Promise<void> {
  const { aiJobId, assetId, projectId: payloadProjectId, language } = job.data || {};
  if (!aiJobId) throw new Error('Missing aiJobId in job data');

  const db = new PrismaClient();
  let tmpDir: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // V11.1 §14: Unique attempt ID per processing attempt
  const attemptId = randomUUID();
  // V12.1 §11: AbortController for cooperative cancellation on heartbeat loss
  const abortController = new AbortController();
  let ownershipLost = false;

  try {
    // V11.1 §15: ATOMIC CLAIM — persist workerId + attemptId + attempt++
    // Only one worker may transition queued → processing.
    const claimResult = await db.aIJob.updateMany({
      where: { id: aiJobId, status: 'queued' },
      data: {
        status: 'processing',
        workerId: WORKER_ID,
        attemptId,
        attempt: { increment: 1 },
        processingStartedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });

    if (claimResult.count === 0) {
      console.log(`[transcription] AIJOB_CLAIMED: ${aiJobId} already claimed — skipping (worker=${WORKER_ID})`);
      return;
    }

    console.log(`[transcription] AIJOB_CLAIMED: ${aiJobId} attempt=${attemptId} worker=${WORKER_ID}`);

    // V11.1 §20: Heartbeat — update heartbeatAt periodically, ownership-guarded.
    // If the heartbeat update affects 0 rows, the worker no longer owns the job.
    heartbeatTimer = setInterval(async () => {
      try {
        const hbResult = await db.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: WORKER_ID,
            attemptId,
          },
          data: { heartbeatAt: new Date() },
        });
        if (hbResult.count === 0) {
          // V12.1 §11: Heartbeat loss must be ACTIONABLE
          console.warn(`[transcription] AIJOB_HEARTBEAT: ${aiJobId} — ownership lost, aborting`);
          ownershipLost = true;
          abortController.abort();
        }
      } catch (err) {
        console.error(`[transcription] AIJOB_HEARTBEAT: ${aiJobId} — error:`, err instanceof Error ? err.message : err);
      }
    }, AI_JOB_HEARTBEAT_MS);

    // Load AIJob after claim to get authoritative state
    const aiJob = await db.aIJob.findUnique({ where: { id: aiJobId } });
    if (!aiJob) throw new Error(`AIJob ${aiJobId} not found after claim`);

    // V11.1 §22-25: Load authoritative values from DB
    const dbProjectId = aiJob.projectId;
    const parsedInput = aiJob.input ? JSON.parse(aiJob.input) : {};
    const dbAssetId = parsedInput.assetId as string | undefined;
    const dbLanguage = parsedInput.language as string | undefined;
    const dbProvider = aiJob.provider || parsedInput.provider || process.env.TRANSCRIPTION_PROVIDER || 'unknown';
    // V12.1 §36: Remove unsafe 'default' model fallback.
    // If no model is configured, use 'unknown' so the transcription identity
    // changes if the real model is later configured (vs 'default' which
    // would collide with different providers that also default to 'default').
    const dbProviderModel = parsedInput.providerModel as string | undefined
      || process.env.TRANSCRIPTION_MODEL
      || 'unknown';

    const authoritativeLanguage = dbLanguage || language;
    const authoritativeAssetId = dbAssetId || assetId;
    if (!authoritativeAssetId) throw new Error('Missing assetId (not in AIJob input or queue payload)');

    // V11.1 §37: Verify asset ownership
    const asset = await db.mediaAsset.findUnique({ where: { id: authoritativeAssetId } });
    if (!asset) throw new Error(`TRANSCRIPTION_ASSET_NOT_FOUND: Asset ${authoritativeAssetId} not found`);
    if (asset.userId !== aiJob.userId) {
      throw new Error(
        `TRANSCRIPTION_ASSET_OWNERSHIP_MISMATCH: AIJob.userId=${aiJob.userId} does not match Asset.userId=${asset.userId}`
      );
    }

    // V11.1 §37: Verify project exists + ownership
    const projectId = dbProjectId;
    if (!projectId) {
      throw new Error('TRANSCRIPTION_PROJECT_NOT_FOUND: AIJob has no projectId');
    }
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new Error(`TRANSCRIPTION_PROJECT_NOT_FOUND: project ${projectId} does not exist`);
    }
    if (project.userId !== aiJob.userId) {
      throw new Error(
        `TRANSCRIPTION_PROJECT_OWNERSHIP_MISMATCH: AIJob.userId=${aiJob.userId} does not match Project.userId=${project.userId}`
      );
    }

    // V11.1 §37: Verify asset/project consistency
    if (asset.projectId && asset.projectId !== project.id) {
      throw new Error(
        `TRANSCRIPTION_ASSET_PROJECT_MISMATCH: Asset.projectId=${asset.projectId} does not match Project.id=${project.id}`
      );
    }

    // Storage validation
    const { getStorage } = await import(`${lib}/storage`);
    const storage = getStorage();

    const headMeta = await storage.headObject(asset.storagePath);
    if (!headMeta) {
      throw new Error('TRANSCRIPTION_INPUT_NOT_FOUND: source object does not exist in storage');
    }
    if (headMeta.size > MAX_TRANSCRIPTION_FILE_BYTES) {
      throw new Error(
        `TRANSCRIPTION_INPUT_TOO_LARGE: file size ${headMeta.size} exceeds limit ${MAX_TRANSCRIPTION_FILE_BYTES}`
      );
    }

    // Stream download to temp file
    tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-tr-'));
    const ext = guessExt(asset.storagePath) || '.wav';
    const sourcePath = path.join(tmpDir, `source${ext}`);

    const stream = await storage.getObjectStream(asset.storagePath);
    await pipeline(stream, createWriteStream(sourcePath));

    // V17.1 §9: DETERMINISTIC TEST HOLD
    // After claim + heartbeat are established AND the source file is staged,
    // pause if the test hold is active. This is the deterministic point the
    // integration test SIGKILLs Worker A.
    //
    // The hold is FAIL-CLOSED: only active when NODE_ENV=test AND
    // AIJOB_TEST_HOLD=true. Production deployments are never paused.
    if (isTestHoldActive()) {
      console.log(
        `[transcription] AIJOB_TEST_HOLD: ${aiJobId} entering hold ` +
        `(attempt=${attemptId} worker=${WORKER_ID}) — waiting for release or SIGKILL`
      );
      // Heartbeat keeps running while we wait — Worker A is still alive
      // and proving it via heartbeat updates. The test verifies the
      // heartbeat is advancing BEFORE SIGKILLing.
      await waitForHoldRelease(aiJobId);
    }

    // If asset is video, extract audio via FFmpeg
    let finalAudioPath = sourcePath;
    if (asset.kind === 'video') {
      try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileP = promisify(execFile);
        const { resolveFfmpeg } = await import(`${lib}/media/binary-resolver`);
        const ffmpegPath = (await resolveFfmpeg()).path;
        const extractedPath = path.join(tmpDir, 'extracted.wav');
        await execFileP(ffmpegPath, [
          '-i', sourcePath, '-vn', '-acodec', 'pcm_s16le',
          '-ar', '16000', '-ac', '1', extractedPath,
        ], { timeout: 60_000 });
        finalAudioPath = extractedPath;
      } catch (err) {
        console.warn(`[transcription] audio extraction failed: ${err instanceof Error ? err.message : err}`);
        finalAudioPath = sourcePath;
      }
    }

    // Transcription with timeout
    const { CaptionService } = await import(`${lib}/ai/caption-service`);
    const captionService = new CaptionService();

    // V12.1 §11: Check ownership before expensive operation
    if (ownershipLost || abortController.signal.aborted) {
      throw new Error(`TRANSCRIPTION_OWNERSHIP_LOST: ${aiJobId} — aborting before provider call`);
    }

    // V12.1 §38: Timeout with cleanup + abort signal
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const cuesPromise = captionService.generateCaptions(finalAudioPath, { language: authoritativeLanguage });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          abortController.abort();
          reject(new Error(`TRANSCRIPTION_TIMEOUT: exceeded ${TRANSCRIPTION_TIMEOUT_MS}ms`));
        }, TRANSCRIPTION_TIMEOUT_MS);
      });
      const cues = await Promise.race([cuesPromise, timeoutPromise]);

      // V12.1 §11: Check ownership after provider returns (before finalization)
      if (ownershipLost || abortController.signal.aborted) {
        throw new Error(`TRANSCRIPTION_OWNERSHIP_LOST: ${aiJobId} — late result from provider, ownership expired`);
      }

      // Deterministic transcription identity
      const { computeTranscriptionIdentity } = await import(`${lib}/transcription/transcription-identity`);
      const transcriptionIdentity = computeTranscriptionIdentity({
        projectId,
        assetId: asset.id,
        provider: dbProvider,
        providerModel: dbProviderModel,
        language: authoritativeLanguage || 'auto',
        cues,
      });

      // V12.1 §19-23: RACE-FREE FINALIZATION
      // The old code used findUnique() → check ownership → update() which has
      // a race window: ownership can change between the check and the update.
      //
      // V12.1 fix: use updateMany with ownership WHERE clause. If 0 rows are
      // updated, the worker has lost ownership — the project mutation must NOT
      // happen. We do project mutation + AIJob completion atomically:
      //
      // 1. First: update AIJob → completed (conditional on ownership)
      // 2. If 0 rows: throw (ownership lost — do NOT mutate project)
      // 3. If 1 row: mutate project timeline (inside same transaction)
      //
      // This guarantees: if AIJob ownership is invalid, NO project mutation occurs.
      await db.$transaction(async (tx) => {
        // V12.1 §20: ATOMIC ownership transition — NOT findUnique+check+update
        const completeResult = await tx.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: WORKER_ID,
            attemptId,
          },
          data: {
            status: 'completed',
            completedAt: new Date(),
            output: JSON.stringify({ cues, assetId: asset.id, language: authoritativeLanguage, transcriptionIdentity }),
            heartbeatAt: null,
          },
        });

        // V12.1 §20: If 0 rows updated, ownership was lost — DO NOT mutate project
        if (completeResult.count === 0) {
          throw new Error(
            `TRANSCRIPTION_STALE_ATTEMPT_REJECTED: AIJob ${aiJobId} — ` +
            `worker=${WORKER_ID} attempt=${attemptId} no longer owns this job. ` +
            `Late result discarded — project NOT mutated.`
          );
        }

        // V12.1 §26: Project mutation happens ONLY after ownership is confirmed
        // (updateMany returned 1 row). Both are in the same transaction.
        const timeline = JSON.parse(project.timelineData || '{}');
        const tracks = timeline.tracks || [];
        const clips = timeline.clips || [];

        const existingClip = clips.find(
          (c: any) => c.kind === 'subtitle' && c.caption?.transcriptionIdentity === transcriptionIdentity
        );
        if (existingClip) {
          existingClip.caption = { ...existingClip.caption, cues, style: 'default', transcriptionIdentity };
        } else {
          let subTrack = tracks.find((t: any) => t.kind === 'subtitle');
          if (!subTrack) {
            const { createTrack } = await import(`${lib}/timeline`);
            subTrack = createTrack('subtitle');
            tracks.push(subTrack);
          }
          const { uid } = await import(`${lib}/timeline`);
          const captionClip = {
            id: uid('clip'),
            trackId: subTrack.id,
            kind: 'subtitle',
            sourceStart: 0,
            sourceEnd: cues[cues.length - 1]?.end ?? 0,
            timelineStart: 0,
            duration: cues[cues.length - 1]?.end ?? 0,
            speed: 1, reverse: false, frozen: null,
            transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
            crop: { top: 0, right: 0, bottom: 0, left: 0 },
            blendMode: 'normal',
            color: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0 },
            audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: true },
            effects: [], filters: [], transitions: [], keyframes: [], masks: [],
            enabled: true,
            label: `Captions (${cues.length} cues)`,
            caption: { cues, style: 'default', transcriptionIdentity },
          };
          clips.push(captionClip);
        }

        await tx.project.update({
          where: { id: projectId },
          data: { timelineData: JSON.stringify({ ...timeline, tracks, clips }) },
        });
      });

      console.log(`[transcription] AIJOB_COMPLETED: ${aiJobId} attempt=${attemptId} worker=${WORKER_ID} cues=${cues.length}`);
    } finally {
      // V11.1 §47: Always clear the timeout timer
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (err) {
    // V11.1 §30: Only the current owner may fail the job
    try {
      const failResult = await db.aIJob.updateMany({
        where: {
          id: aiJobId,
          status: 'processing',
          workerId: WORKER_ID,
          attemptId,
        },
        data: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
          heartbeatAt: null,
        },
      });
      if (failResult.count === 0) {
        console.warn(`[transcription] AIJOB_STALE_ATTEMPT_REJECTED: cannot fail ${aiJobId} — worker=${WORKER_ID} no longer owns it`);
      } else {
        console.log(`[transcription] AIJOB_FAILED: ${aiJobId} attempt=${attemptId} worker=${WORKER_ID}`);
      }
    } catch (failErr) {
      console.error(`[transcription] failed to mark AIJob ${aiJobId} as failed:`, failErr);
    }
    throw err;
  } finally {
    // V11.1 §22: Stop heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // V17.1 §9: Clean up test-hold sentinel files (test mode only)
    if (isTestHoldActive()) {
      cleanupTestHold(aiJobId);
    }
    // V11.1 §23: Cleanup temp dir
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  }
}

function guessExt(key: string): string {
  const m = key.match(/\.([a-zA-Z0-9]{2,4})$/);
  return m ? `.${m[1].toLowerCase()}` : '';
}
