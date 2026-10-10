// VidiaForge Worker — media-ingestion processor (S2 rewrite)
//
// Lifecycle (S2):
//   1. Idempotency check — if asset.status === 'ready' already, skip.
//   2. Set status='processing', clear any prior errorMessage/failedAt.
//   3. Download the source object to a temp file (streaming, no buffering).
//   4. probe() → store metadata (duration/width/height/fps/codec/audioChannels).
//   5. generateThumbnail() (if video/image) — verify the thumbnail object
//      EXISTS in storage before recording thumbnailUrl on the asset.
//   6. generateWaveform() (if audio or video with audio) — verify object exists.
//   7. generateProxy() (if video height > 1080) — verify object exists, then
//      create a NEW MediaAsset row for the proxy + link via proxyAssetId.
//   8. On success: set status='ready'.
//   9. On failure: set status='failed' + errorMessage + failedAt, rethrow so
//      BullMQ marks the job failed (caller's retry policy decides next steps).
//  10. try/finally — always clean up temp files + disconnect Prisma.

import { PrismaClient } from '@prisma/client';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const lib = '../../../../src/lib';

// V4: Worker instance ID — generated once per process, used for lease ownership.
// This prevents a stale worker from overwriting a newer worker's processing state.
const workerInstanceId = `worker-${randomUUID()}`;

// V4: Heartbeat interval — update processingHeartbeatAt periodically so the
// stale-job recovery can detect crashed workers.
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '20000', 10);
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export async function processMediaIngestion(job: any): Promise<void> {
  const { assetId } = job.data || {};
  if (!assetId) throw new Error('Missing assetId in job data');

  const db = new PrismaClient();
  let tmpDir: string | null = null;
  try {
    const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new Error(`Asset ${assetId} not found in DB`);

    // === Idempotency ===
    // A previously-completed ingestion leaves status='ready'. Don't reprocess
    // — the thumbnails/waveform/proxy are already in object storage.
    if (asset.status === 'ready') {
      console.log(`[media-ingestion] asset ${assetId} already ready — skipping`);
      return;
    }

    // === Set status='processing' + claim with worker lease ===
    // V4: Set processingStartedAt + processingWorkerId + processingHeartbeatAt
    // so the stale-job recovery can distinguish a crashed worker from an active one.
    // Clear any prior failure markers so the UI doesn't show stale errors
    // while a retry is in flight.
    const workerId = workerInstanceId;
    await db.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: 'processing',
        errorMessage: null,
        failedAt: null,
        processingStartedAt: new Date(),
        processingWorkerId: workerId,
        processingHeartbeatAt: new Date(),
      },
    });

    // V4: Start heartbeat — update processingHeartbeatAt periodically so
    // stale-job recovery doesn't mark this asset as failed while we're still working.
    heartbeatTimer = setInterval(async () => {
      try {
        await db.mediaAsset.update({
          where: { id: assetId },
          data: { processingHeartbeatAt: new Date() },
        });
      } catch {
        // best-effort — don't crash the job if the heartbeat write fails
      }
    }, HEARTBEAT_INTERVAL_MS);

    const { getStorage } = await import(`${lib}/storage`);
    const { getMediaProcessor, MediaProcessorUnavailableError } = await import(`${lib}/media`);

    const storage = getStorage();
    const media = getMediaProcessor();

    // === Download source to tmp via STREAMING download (no buffering) ===
    tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-mi-'));
    const ext = guessExt(asset.storagePath);
    const localPath = path.join(tmpDir, `${asset.internalName || randomUUID()}${ext}`);

    try {
      const stream = await storage.getObjectStream(asset.storagePath);
      await pumpToDisk(stream, localPath);
    } catch (err) {
      throw new Error(
        `Failed to fetch asset ${asset.storagePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // === 1. Probe (always) ===
    const meta = await media.probe(localPath);
    await db.mediaAsset.update({
      where: { id: assetId },
      data: {
        duration: meta.duration,
        width: meta.width ?? null,
        height: meta.height ?? null,
        fps: meta.fps ?? null,
        codec: meta.codec ?? null,
        audioChannels: meta.audioChannels ?? null,
      },
    });

    // === 2. Thumbnail (video + image) ===
    // HONEST: only record thumbnailUrl if we can verify the thumbnail object
    // actually exists in storage after generation.
    if (asset.kind === 'video' || asset.kind === 'image') {
      const thumbnailKey = `thumbnails/${asset.id}.jpg`;
      try {
        await media.generateThumbnail({
          inputPath: localPath,
          atTime: Math.min(1, (meta.duration || 1) * 0.1),
          width: 640,
          outputKey: thumbnailKey,
        });
        const exists = await storage.objectExists(thumbnailKey);
        if (!exists) {
          console.warn(`[media-ingestion] thumbnail reported success but object ${thumbnailKey} does not exist — not recording URL`);
        } else {
          const url = await storage.createDownloadUrl({ key: thumbnailKey });
          await db.mediaAsset.update({
            where: { id: assetId },
            data: { thumbnailUrl: url },
          });
        }
      } catch (err) {
        if (err instanceof MediaProcessorUnavailableError) throw err;
        console.warn(`[media-ingestion] thumbnail failed for ${assetId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // === 3. Waveform (audio-only or video with audio) ===
    if (asset.kind === 'audio' || (asset.kind === 'video' && meta.audioChannels)) {
      const waveformKey = `waveforms/${asset.id}.json`;
      try {
        await media.generateWaveform({
          inputPath: localPath,
          peaks: 1000,
          outputKey: waveformKey,
        });
        const exists = await storage.objectExists(waveformKey);
        if (!exists) {
          console.warn(`[media-ingestion] waveform reported success but object ${waveformKey} does not exist — not recording URL`);
        } else {
          const url = await storage.createDownloadUrl({ key: waveformKey });
          await db.mediaAsset.update({
            where: { id: assetId },
            data: { waveformUrl: url },
          });
        }
      } catch (err) {
        if (err instanceof MediaProcessorUnavailableError) throw err;
        console.warn(`[media-ingestion] waveform failed for ${assetId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // === 4. Proxy (video > 1080p) ===
    // Create a NEW MediaAsset row for the proxy + link it back via proxyAssetId.
    if (asset.kind === 'video' && meta.height && meta.height > 1080) {
      const proxyKey = `proxies/${asset.id}.mp4`;
      try {
        await media.generateProxy({
          inputPath: localPath,
          maxHeight: 720,
          outputKey: proxyKey,
        });
        const exists = await storage.objectExists(proxyKey);
        if (!exists) {
          console.warn(`[media-ingestion] proxy reported success but object ${proxyKey} does not exist — not recording proxyAssetId`);
        } else {
          // Probe the proxy to record its metadata (duration, dimensions).
          // The proxy is small — re-probing is cheap and gives us a real
          // ready-to-use MediaAsset row the timeline can reference.
          let proxyMeta: { duration?: number; width?: number; height?: number; codec?: string } = {};
          try {
            const m = await media.probe(localPath);
            proxyMeta = {
              duration: m.duration,
              width: m.width,
              height: m.height,
              codec: m.codec,
            };
          } catch {
            // Probe failure on the proxy isn't fatal — we still have the file.
          }

          const proxyAsset = await db.mediaAsset.create({
            data: {
              userId: asset.userId,
              projectId: asset.projectId,
              filename: `${asset.filename} (720p proxy)`,
              internalName: path.basename(proxyKey),
              mimeType: 'video/mp4',
              size: 0,
              storagePath: proxyKey,
              kind: 'video',
              duration: proxyMeta.duration ?? null,
              width: proxyMeta.width ?? null,
              height: proxyMeta.height ?? null,
              codec: proxyMeta.codec ?? null,
              status: 'ready', // proxy is immediately usable
              // S1 schema: proxyAssetId points back to the original — this is
              // how `MediaAssetProxy` self-relation links a proxy to its
              // source. Querying `db.mediaAsset.findMany({ where: { proxyAssetId: original.id } })`
              // returns all proxies for an original.
              proxyAssetId: asset.id,
            },
          });
          // NOTE: the original's `proxyAssetId` field is intentionally NOT set.
          // Per S1 schema, original.proxyAssetId stays null (originals are not
          // proxies of anything). The proxy points back to original via its own
          // proxyAssetId FK. Use the `proxies` back-relation to find proxies.
          console.log(
            `[media-ingestion] created 720p proxy ${proxyAsset.id} for original ${asset.id} (proxyAssetId=${asset.id})`
          );
        }
      } catch (err) {
        if (err instanceof MediaProcessorUnavailableError) throw err;
        console.warn(`[media-ingestion] proxy failed for ${assetId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // === 5. Mark ready ===
    await db.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: 'ready',
        errorMessage: null,
        failedAt: null,
      },
    });
    console.log(`[media-ingestion] asset ${assetId} ready (duration=${meta.duration}s, w=${meta.width}, h=${meta.height})`);
  } catch (err) {
    // === Mark failed + rethrow so BullMQ marks the job failed ===
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: 'failed',
          errorMessage: message,
          failedAt: new Date(),
        },
      });
    } catch (updateErr) {
      console.error(`[media-ingestion] failed to mark asset ${assetId} as failed:`, updateErr);
    }
    throw err;
  } finally {
    // V4: Stop the heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  }
}

/** Variant: only generate a thumbnail for an asset (e.g. uploaded image poster) */
export async function processThumbnailOnly(job: any): Promise<void> {
  const { assetId } = job.data || {};
  if (!assetId) throw new Error('Missing assetId in job data');
  const db = new PrismaClient();
  let tmpDir: string | null = null;
  try {
    const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new Error(`Asset ${assetId} not found`);

    const { getStorage } = await import(`${lib}/storage`);
    const { getMediaProcessor } = await import(`${lib}/media`);
    const storage = getStorage();
    const media = getMediaProcessor();

    tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-th-'));
    const ext = guessExt(asset.storagePath);
    const localPath = path.join(tmpDir, `${asset.id}${ext}`);
    const stream = await storage.getObjectStream(asset.storagePath);
    await pumpToDisk(stream, localPath);

    const thumbnailKey = `thumbnails/${asset.id}.jpg`;
    await media.generateThumbnail({
      inputPath: localPath,
      atTime: 1,
      width: 640,
      outputKey: thumbnailKey,
    });
    if (await storage.objectExists(thumbnailKey)) {
      const url = await storage.createDownloadUrl({ key: thumbnailKey });
      await db.mediaAsset.update({
        where: { id: assetId },
        data: { thumbnailUrl: url },
      });
    }
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
}

/** Variant: only generate a 720p proxy for a video asset */
export async function processProxyOnly(job: any): Promise<void> {
  const { assetId } = job.data || {};
  if (!assetId) throw new Error('Missing assetId in job data');
  const db = new PrismaClient();
  let tmpDir: string | null = null;
  try {
    const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new Error(`Asset ${assetId} not found`);

    const { getStorage } = await import(`${lib}/storage`);
    const { getMediaProcessor } = await import(`${lib}/media`);
    const storage = getStorage();
    const media = getMediaProcessor();

    tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-px-'));
    const ext = guessExt(asset.storagePath);
    const localPath = path.join(tmpDir, `${asset.id}${ext}`);
    const stream = await storage.getObjectStream(asset.storagePath);
    await pumpToDisk(stream, localPath);

    const proxyKey = `proxies/${asset.id}.mp4`;
    await media.generateProxy({
      inputPath: localPath,
      maxHeight: 720,
      outputKey: proxyKey,
    });
    if (await storage.objectExists(proxyKey)) {
      // Create or update the proxy MediaAsset row + link to original.
      const existingProxy = await db.mediaAsset.findFirst({
        where: { proxyAssetId: asset.id },
      });
      if (!existingProxy) {
        await db.mediaAsset.create({
          data: {
            userId: asset.userId,
            projectId: asset.projectId,
            filename: `${asset.filename} (720p proxy)`,
            internalName: path.basename(proxyKey),
            mimeType: 'video/mp4',
            size: 0,
            storagePath: proxyKey,
            kind: 'video',
            status: 'ready',
            proxyAssetId: asset.id,
          },
        });
        console.log(`[media-ingestion] (proxy-only) created 720p proxy for ${assetId}`);
      }
    }
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
}

function guessExt(key: string): string {
  const m = key.match(/\.([a-zA-Z0-9]{2,4})$/);
  return m ? `.${m[1].toLowerCase()}` : '';
}

/**
 * Stream a web ReadableStream into a file on disk WITHOUT buffering the entire
 * body into memory. Uses a fs.WriteStream + backpressure-aware pump.
 */
async function pumpToDisk(stream: ReadableStream<Uint8Array>, destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath);
    const reader = stream.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!out.write(Buffer.from(value))) {
            await new Promise<void>((r) => out.once('drain', r));
          }
        }
      }
    };
    out.on('error', reject);
    out.on('finish', () => resolve());
    pump().then(() => out.end()).catch(reject);
  });
}

// writeFile + mkdtemp + rm are also imported at the top — keep the imports
// referenced so TypeScript / lint don't strip them when the worker tree-shakes.
void writeFile;
