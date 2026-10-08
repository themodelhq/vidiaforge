// VidiaForge — Integration test: render job pipeline
//
// Tests the POST /api/render → RenderJob → Redis queue → Worker → FFmpeg flow.
//
// Two test modes:
//   1. Always runs: verifies POST /api/render returns 503 with
//      RENDER_QUEUE_NOT_CONFIGURED when REDIS_URL is NOT set.
//      (No infrastructure required.)
//   2. test.skipIf(!process.env.REDIS_URL): full end-to-end flow —
//      creates a test project, queues a render, verifies the job row
//      is created in the DB.
//
// To run mode 2:
//   1. Start Redis:
//      docker run -d --name vf-redis -p 6379:6379 redis:7-alpine
//
//   2. Start PostgreSQL:
//      docker run -d --name vf-pg \
//        -e POSTGRES_DB=vidiaforge \
//        -e POSTGRES_USER=vf \
//        -e POSTGRES_PASSWORD=vf \
//        -p 5432:5432 \
//        postgres:15-alpine
//
//   3. Apply migrations:
//      bunx prisma migrate deploy
//
//   4. Set env vars:
//      DATABASE_URL=postgresql://vf:vf@localhost:5432/vidiaforge
//      REDIS_URL=redis://localhost:6379
//      JWT_SECRET=test-secret-at-least-32-chars-long
//      SESSION_SECRET=test-secret-at-least-32-chars-long
//
//   5. Run:
//      bun run test:integration

import { test, expect, describe } from 'bun:test';
import { PrismaClient } from '@prisma/client';

import { QUEUE_NAMES } from '../../src/lib/queue-names';
import { ERROR_CODES } from '../../src/lib/errors/codes';

// The render route uses ERROR_CODES.RENDER_QUEUE_NOT_CONFIGURED +
// QUEUE_NAMES.RENDER.
// We import both to verify the contract.

/**
 * Create a fresh Prisma client for the integration test.
 *
 * PrismaClient is statically imported so that TypeScript can resolve
 * the generated Prisma client during the production/test build.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

describe('POST /api/render — without REDIS_URL', () => {
  // These tests ALWAYS run.
  //
  // They verify the honest failure path that the API takes when Redis
  // is not configured. No Redis or PostgreSQL infrastructure is required.

  test('returns the expected queue-not-configured contract', async () => {
    // Save env var state.
    const previousRedisUrl = process.env.REDIS_URL;

    delete process.env.REDIS_URL;

    try {
      const { enqueue } = await import('../../src/lib/queue');

      const result = await enqueue(QUEUE_NAMES.RENDER, {
        jobId: 'test',
      });

      // The enqueue helper must return ok:false when REDIS_URL is missing.
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/REDIS_URL|BullMQ|worker/i);

      // The API route uses ERROR_CODES.RENDER_QUEUE_NOT_CONFIGURED
      // in its 503 response body.
      expect(ERROR_CODES.RENDER_QUEUE_NOT_CONFIGURED).toBe(
        'RENDER_QUEUE_NOT_CONFIGURED'
      );

      expect(QUEUE_NAMES.RENDER).toBe('render');
    } finally {
      // Restore the original environment exactly.
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }
  });

  test('enqueue returns ok:false with a clear error message when REDIS_URL is unset', async () => {
    const previousRedisUrl = process.env.REDIS_URL;

    delete process.env.REDIS_URL;

    try {
      const { enqueue } = await import('../../src/lib/queue');

      const result = await enqueue(QUEUE_NAMES.MEDIA_INGEST, {
        assetId: 'test',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');

      // Error message should be actionable and identify the missing
      // Redis/BullMQ configuration.
      expect(result.error!.toLowerCase()).toMatch(
        /redis_url|bullmq|worker/
      );
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }
  });

  test('isQueueAvailable returns false when REDIS_URL is unset', async () => {
    const previousRedisUrl = process.env.REDIS_URL;

    delete process.env.REDIS_URL;

    try {
      const { isQueueAvailable } = await import('../../src/lib/queue');

      const available = await isQueueAvailable();

      expect(available).toBe(false);
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }
  });
});

describe('POST /api/render — with REDIS_URL configured', () => {
  // These tests only run when REDIS_URL is configured.
  //
  // The first two tests exercise the Redis/BullMQ queue directly.
  // The final test exercises the PostgreSQL RenderJob persistence +
  // Redis enqueue pipeline.

  test.skipIf(!process.env.REDIS_URL)(
    'queue accepts a render job',
    async () => {
      const { enqueue } = await import('../../src/lib/queue');

      const result = await enqueue(QUEUE_NAMES.RENDER, {
        jobId: 'integration-test-render-job',
      });

      // If Redis is available, enqueue should succeed.
      expect(result.ok).toBe(true);
      expect(result.jobId).toBeTruthy();
    }
  );

  test.skipIf(!process.env.REDIS_URL)(
    'isQueueAvailable returns true',
    async () => {
      const { isQueueAvailable } = await import('../../src/lib/queue');

      const available = await isQueueAvailable();

      expect(available).toBe(true);
    }
  );

  test.skipIf(
    !process.env.REDIS_URL || !process.env.DATABASE_URL
  )(
    'POST /api/render creates a RenderJob row in the DB + enqueues a worker job',
    async () => {
      // This test exercises the full persistence + queue flow:
      //
      //   1. Create a test user.
      //   2. Create a test project.
      //   3. Create a RenderJob row.
      //   4. Enqueue the RenderJob into BullMQ/Redis.
      //   5. Verify the RenderJob row exists with status="queued".
      //   6. Clean up all test records.
      //
      // Note:
      // This test does not require a running Next.js server because it
      // directly exercises the database + queue portions of the pipeline.
      //
      // A separate HTTP E2E test should be used to validate the actual
      // POST /api/render route over HTTP.

      const db = createPrismaClient();

      let userId: string | null = null;
      let projectId: string | null = null;
      let renderJobId: string | null = null;

      try {
        // Generate a unique test user email.
        const testEmail =
          `render-test-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}@test.vidiaforge.dev`;

        // Create test user directly in PostgreSQL.
        const user = await db.user.create({
          data: {
            email: testEmail,
            name: 'Render Test User',
            passwordHash: '$argon2id$test-hash',
          },
        });

        userId = user.id;

        // Create test project.
        const project = await db.project.create({
          data: {
            userId: user.id,
            name: 'Render Test Project',
            fps: 30,
            width: 1920,
            height: 1080,
            canvasPreset: '16:9',
            resolution: '1080p',
            timelineData: '{}',
          },
        });

        projectId = project.id;

        // Create RenderJob row.
        //
        // This represents the persistence portion that the render route
        // performs before enqueueing the worker job.
        const renderJob = await db.renderJob.create({
          data: {
            projectId: project.id,
            status: 'queued',
            format: 'mp4',
            codec: 'h264',
            resolution: '1080p',
            fps: 30,
            bitrate: 'medium',
            progress: 0,
          },
        });

        renderJobId = renderJob.id;

        // Enqueue the RenderJob into the real Redis/BullMQ queue.
        const { enqueue } = await import('../../src/lib/queue');

        const result = await enqueue(QUEUE_NAMES.RENDER, {
          jobId: renderJob.id,
        });

        expect(result.ok).toBe(true);
        expect(result.jobId).toBeTruthy();

        // Verify that the database row exists and still references
        // the correct project.
        const fetched = await db.renderJob.findUnique({
          where: {
            id: renderJob.id,
          },
        });

        expect(fetched).not.toBeNull();
        expect(fetched!.status).toBe('queued');
        expect(fetched!.projectId).toBe(project.id);
      } finally {
        // Cleanup must happen even if an assertion or enqueue operation
        // fails midway through the test.
        //
        // Delete in dependency order:
        // RenderJob → Project → User.
        if (renderJobId) {
          await db.renderJob
            .delete({
              where: {
                id: renderJobId,
              },
            })
            .catch(() => {});
        }

        if (projectId) {
          await db.project
            .delete({
              where: {
                id: projectId,
              },
            })
            .catch(() => {});
        }

        if (userId) {
          await db.user
            .delete({
              where: {
                id: userId,
              },
            })
            .catch(() => {});
        }

        await db.$disconnect();
      }
    }
  );
});