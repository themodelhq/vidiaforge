// /api/ai/transcribe — POST { assetId, projectId?, language? }
// V10.1 BLOCKER 1: Full authorization — verify asset ownership, project ownership,
// and asset/project consistency BEFORE creating the AIJob.
//
// Defense in depth: the worker independently re-verifies all relationships.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { enqueue } from '@/lib/queue';
import { QUEUE_NAMES } from '@/lib/queue-names';
import { ERROR_CODES } from '@/lib/errors/codes';
import { getTranscriptionProvider } from '@/lib/ai/transcription';
import { checkAiRate } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 10 AI requests per minute per user
  const rl = checkAiRate(user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many AI requests. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const assetId = typeof body?.assetId === 'string' ? body.assetId : null;
  if (!assetId) {
    return NextResponse.json({ error: 'assetId required' }, { status: 400 });
  }
  const language = typeof body?.language === 'string' ? body.language : undefined;
  const suppliedProjectId = typeof body?.projectId === 'string' ? body.projectId : null;

  // V10.1 BLOCKER 1 §5-8: Load asset + verify ownership
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  // V10.1 §8: Do not leak resource existence — return 404 for unauthorized access
  if (asset.userId !== user.id) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // V10.1 BLOCKER 1 §5-7: Verify project ownership + asset/project consistency
  let authoritativeProjectId: string | null;

  if (suppliedProjectId) {
    // Load project + verify it belongs to the authenticated user
    const project = await db.project.findUnique({ where: { id: suppliedProjectId } });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    // V10.1 §8: Do not leak — 404 instead of 403
    if (project.userId !== user.id) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // V10.1 §7: Verify asset belongs to this project
    if (asset.projectId && asset.projectId !== project.id) {
      return NextResponse.json(
        { error: 'Asset does not belong to the specified project', code: 'TRANSCRIPTION_ASSET_PROJECT_MISMATCH' },
        { status: 400 }
      );
    }
    authoritativeProjectId = project.id;
  } else {
    // Use asset's project as authoritative
    authoritativeProjectId = asset.projectId;
  }

  // V5: Use the factory to check if a REAL provider is configured.
  const provider = getTranscriptionProvider();
  if (!provider) {
    const providerName = process.env.TRANSCRIPTION_PROVIDER || '(not set)';
    return NextResponse.json(
      {
        error:
          'Transcription requires a configured provider. Set TRANSCRIPTION_PROVIDER=openai or deepgram and the corresponding API key.',
        code: ERROR_CODES.TRANSCRIPTION_PROVIDER_NOT_CONFIGURED,
        detail: `TRANSCRIPTION_PROVIDER="${providerName}". "local" is not a production-ready provider.`,
      },
      { status: 503 }
    );
  }

  // V10.1 §22-25: Persist authoritative configuration in the AIJob
  const providerName = process.env.TRANSCRIPTION_PROVIDER || 'unknown';
  // V17.1 §54: Remove unsafe 'default' model fallback. Use 'unknown' so the
  // transcription identity changes if the real model is later configured
  // (matches the worker's V12.1 §36 fix).
  const providerModel = process.env.TRANSCRIPTION_MODEL || 'unknown';

  // Create AIJob with authoritative values
  const aiJob = await db.aIJob.create({
    data: {
      userId: user.id,
      projectId: authoritativeProjectId,
      kind: 'transcribe',
      status: 'queued',
      input: JSON.stringify({ assetId, language, provider: providerName, providerModel }),
      provider: providerName,
    },
  });

  const enq = await enqueue(QUEUE_NAMES.TRANSCRIPTION, {
    aiJobId: aiJob.id,
    assetId,
    projectId: authoritativeProjectId,
    language,
  });

  if (!enq.ok) {
    await db.aIJob.update({
      where: { id: aiJob.id },
      data: {
        status: 'failed',
        error: `Transcription pipeline not configured: ${enq.error}`,
        completedAt: new Date(),
      },
    });
    return NextResponse.json(
      {
        error: 'Transcription queue not configured. Set REDIS_URL to enable transcription.',
        code: ERROR_CODES.TRANSCRIPTION_PROVIDER_NOT_CONFIGURED,
        detail: enq.error,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ jobId: aiJob.id, queued: true, queueJobId: enq.jobId }, { status: 201 });
}
