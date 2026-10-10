// /api/ai/edit — Translate natural-language editing requests into structured edit commands
// using z-ai-web-dev-sdk. Validates the LLM response against the Zod schema and runs
// safety checks. Returns:
//   {
//     summary: string,
//     commands: AICommand[],         // only VALID + SUPPORTED commands
//     unsupported: AICommand[],     // LLM commands whose `type` is NOT in COMMAND_TYPES
//     validation: { valid, warnings, fallback },
//   }
// Does NOT execute — execution happens client-side via the executor after user approval.
//
// S2 HONESTY: if the LLM returns commands of unsupported types (anything not in
// COMMAND_TYPES from schema.ts), they are NOT silently dropped — they are
// surfaced in the `unsupported` array so the UI can show "AI suggested X but X
// is not yet implemented" rather than pretending the LLM produced no output.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { validateAIResponse } from '@/lib/ai/command-engine/validator';
import { safetyCheck } from '@/lib/ai/command-engine/safety';
import { COMMAND_TYPES } from '@/lib/ai/command-engine/schema';
import type { ProjectContext } from '@/lib/ai/command-engine/safety';

const SYSTEM_PROMPT = `You are VidiaForge AI, an assistant that translates natural-language editing requests into structured edit commands. Respond ONLY with valid JSON: { "summary": string, "commands": Command[] }. Never destroy user data — produce previewable operations.

Available command types and their parameters:
- apply_filter     { "filter": "cinematic"|"warm"|"cool"|"vintage"|"film"|"bw"|"high-contrast"|"moody"|"vibrant"|"portrait"|"golden-hour", "intensity": 0..1 }
- adjust_color     { "contrast"?: -1..1, "saturation"?: -1..1, "temperature"?: -1..1, "brightness"?: -1..1 }
- add_vignette     { "amount": 0..1 }
- split_clip       { "clipId": string, "time": number (seconds) }
- add_text         { "text": string, "position": "center"|"top"|"bottom"|"top-left"|"top-right"|"bottom-left"|"bottom-right", "duration": number (seconds) }
- remove_silence   {} (no params)
- create_shorts    { "count": number (1..10) }
- add_captions     {} (auto-generated captions)
- make_cinematic   {} (apply cinematic look + letterbox feel)
- duck_music       {} (auto-duck music under dialogue)
- increase_speed   { "factor": 0.25..4 }
- add_transition   { "transitionType": "cut"|"cross-dissolve"|"fade"|"dip-to-black"|"dip-to-white"|"wipe"|"slide"|"zoom"|"blur"|"spin"|"glitch"|"light-leak"|"film-burn"|"flash"|"whip-pan"|"morph"|"push", "duration": number (seconds) }

Note: every command object has a top-level "type" field with the command name (e.g. "add_transition"). Command-specific parameters are siblings of "type".

Rules:
- Always include a short, friendly "summary" string.
- Always include a non-empty "commands" array.
- If the user asks to "make it cinematic" or similar, emit at least: apply_filter (cinematic), adjust_color (contrast up, saturation slightly down, temperature warm), and add_vignette.
- Never include markdown fences. Only emit the JSON object.`;

interface AIEditCommand {
  type: string;
  [k: string]: unknown;
}
interface AIEditResult {
  summary: string;
  commands: AIEditCommand[];
}

// Deterministic fallback used when the SDK is unavailable or throws.
function buildFallback(prompt: string): AIEditResult {
  const p = prompt.toLowerCase();
  if (
    p.includes('cinematic') ||
    p.includes('movie') ||
    p.includes('film look') ||
    p.includes('moody')
  ) {
    return {
      summary:
        'Applied a cinematic look with a teal-orange grade, lifted contrast, and a soft vignette.',
      commands: [
        { type: 'apply_filter', filter: 'cinematic', intensity: 0.75 },
        {
          type: 'adjust_color',
          contrast: 0.18,
          saturation: -0.1,
          temperature: 0.12,
          brightness: -0.04,
        },
        { type: 'add_vignette', amount: 0.4 },
        { type: 'add_transition', transitionType: 'cross-dissolve', duration: 0.5 },
      ],
    };
  }
  if (p.includes('caption')) {
    return {
      summary: 'Added auto-generated captions for dialogue.',
      commands: [{ type: 'add_caption' }],
    };
  }
  if (p.includes('silence')) {
    return {
      summary: 'Removed silences from the timeline.',
      commands: [{ type: 'remove_silence' }],
    };
  }
  if (p.includes('short') || p.includes('tiktok') || p.includes('reels')) {
    return {
      summary: 'Created 3 vertical short clips from the highlights.',
      commands: [{ type: 'create_short', count: 3 }],
    };
  }
  if (p.includes('speed') || p.includes('faster') || p.includes('slower')) {
    const factor = p.includes('slower') ? 0.5 : 1.5;
    return {
      summary: `Adjusted playback speed to ${factor}x.`,
      commands: [{ type: 'change_speed', factor }],
    };
  }
  return {
    summary:
      'Applied a subtle cinematic grade with a soft vignette and a cross-dissolve transition.',
    commands: [
      { type: 'apply_filter', filter: 'cinematic', intensity: 0.5 },
      { type: 'add_vignette', amount: 0.3 },
      { type: 'add_transition', transitionType: 'cross-dissolve', duration: 0.4 },
    ],
  };
}

function tryParseCommands(raw: string): AIEditResult | null {
  if (!raw) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const cmds = Array.isArray(obj.commands) ? obj.commands : [];
  const commands: AIEditCommand[] = [];
  for (const c of cmds) {
    if (c && typeof c === 'object' && typeof (c as any).type === 'string') {
      commands.push(c as AIEditCommand);
    }
  }
  if (!summary && commands.length === 0) return null;
  return { summary: summary || 'AI edit applied.', commands };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  }

  const projectContextRaw =
    body?.projectContext && typeof body.projectContext === 'object'
      ? body.projectContext
      : null;

  const userMessage = projectContextRaw
    ? `Project context: ${JSON.stringify(projectContextRaw)}\n\nUser request: ${prompt}`
    : `User request: ${prompt}`;

  let llmResult: AIEditResult | null = null;
  let llmError: string | null = null;
  let fallbackUsed = false;

  try {
    const ZAIModule = await import('z-ai-web-dev-sdk');
    const ZAI = (ZAIModule as any).default ?? (ZAIModule as any).ZAIWebDevSDK;
    if (typeof ZAI?.create !== 'function') {
      throw new Error('z-ai-web-dev-sdk default export has no create()');
    }
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      model: 'glm-4.6',
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    } as any);

    const raw: string =
      completion?.choices?.[0]?.message?.content ??
      completion?.choices?.[0]?.message?.reasoning_content ??
      '';

    llmResult = tryParseCommands(raw);
    if (!llmResult) {
      // LLM returned non-JSON; fall back.
      llmResult = buildFallback(prompt);
      fallbackUsed = true;
    }
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
    llmResult = buildFallback(prompt);
    fallbackUsed = true;
  }

  // Validate via Zod schema — strips unknown fields, catches malformed commands.
  const validation = validateAIResponse(llmResult);

  // S2: collect unsupported commands separately.
  // Walk the raw LLM output and pick out every command object whose `type`
  // is NOT in the supported COMMAND_TYPES list (or whose type is missing).
  // These are surfaced in the response as `unsupported` so the UI can show
  // "AI suggested X but X is not yet implemented" instead of silently dropping them.
  const SUPPORTED_TYPES = new Set<string>(COMMAND_TYPES as readonly string[]);
  const rawCommands: AIEditCommand[] = Array.isArray((llmResult as any)?.commands)
    ? (llmResult as any).commands.filter(
        (c: any) => c && typeof c === 'object' && typeof (c as any).type === 'string'
      )
    : [];
  const unsupported: AIEditCommand[] = [];
  for (const raw of rawCommands) {
    if (!SUPPORTED_TYPES.has(raw.type)) {
      unsupported.push(raw);
    }
  }

  if (!validation.ok) {
    // Fall back to a safe minimal command set
    const fb = buildFallback(prompt);
    const fbValidation = validateAIResponse(fb);
    if (fbValidation.ok) {
      return NextResponse.json({
        ...fbValidation.data,
        unsupported,
        validation: {
          valid: false,
          warnings: validation.errors,
          fallback: true,
        },
        fallback: true,
        error: llmError,
      });
    }
    return NextResponse.json(
      {
        error: 'AI response failed validation',
        errors: validation.errors,
        unsupported,
        fallback: true,
      },
      { status: 502 }
    );
  }

  // Run safety checks against the project context (clip IDs, etc.)
  const projectCtx: ProjectContext = projectContextRaw
    ? {
        clipIds: new Set(
          Array.isArray(projectContextRaw.clipIds)
            ? projectContextRaw.clipIds
            : Array.isArray(projectContextRaw.clips)
              ? projectContextRaw.clips.map((c: any) => c.id).filter(Boolean)
              : []
        ),
        clipCount: projectContextRaw.clipCount ?? (projectContextRaw.clips?.length ?? 0),
        duration: projectContextRaw.duration ?? 0,
      }
    : { clipIds: new Set(), clipCount: 0, duration: 0 };

  const safety = safetyCheck(validation.data.commands, projectCtx);

  return NextResponse.json({
    ...validation.data,
    unsupported,
    validation: {
      valid: safety.safe,
      warnings: safety.warnings,
      fallback: fallbackUsed,
    },
    fallback: fallbackUsed || undefined,
    error: llmError || undefined,
  });
}
