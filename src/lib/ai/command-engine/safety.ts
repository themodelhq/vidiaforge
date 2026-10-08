// VidiaForge — AI safety check
// Heuristic safety layer that runs AFTER schema validation.
// Checks: dangling clip references, destructive batch limits, auto-export gating.

import type { AICommand } from './schema';

export interface ProjectContext {
  /** All known clip IDs in the project. */
  clipIds: Set<string>;
  /** Number of clips currently in the timeline. */
  clipCount: number;
  /** Total project duration in seconds. */
  duration: number;
}

export interface SafetyResult {
  safe: boolean;
  warnings: string[];
}

const MAX_COMMANDS = 50;

/**
 * Run safety checks on a validated command list.
 * "safe" means: no destructive commands, no dangling refs to non-existent clips,
 * no batch > 50 commands, no auto-export for create_short / reframe without confirmation.
 *
 * Note: this returns warnings rather than rejecting — the UI can show them and ask the
 * user to confirm. Only "safe: false" when there's a hard violation (e.g. > MAX_COMMANDS).
 */
export function safetyCheck(commands: AICommand[], ctx: ProjectContext): SafetyResult {
  const warnings: string[] = [];

  // 1. Batch size limit
  if (commands.length > MAX_COMMANDS) {
    return {
      safe: false,
      warnings: [
        `Batch contains ${commands.length} commands — limit is ${MAX_COMMANDS}. ` +
          'Split into smaller batches or apply incrementally.',
      ],
    };
  }
  if (commands.length > 25) {
    warnings.push(`Large batch (${commands.length} commands). Review carefully before applying.`);
  }

  // 2. Dangling clip references
  const referencedClipIds = new Set<string>();
  for (const cmd of commands) {
    const clipId = (cmd as { clipId?: string }).clipId;
    if (typeof clipId === 'string') referencedClipIds.add(clipId);
  }
  const dangling = [...referencedClipIds].filter((id) => !ctx.clipIds.has(id));
  if (dangling.length > 0) {
    warnings.push(
      `${dangling.length} command(s) reference unknown clip(s): ${dangling.slice(0, 5).join(', ')}${dangling.length > 5 ? ` (+${dangling.length - 5} more)` : ''}. ` +
        'These will be skipped at execution time.'
    );
  }

  // 3. Destructive command detection — delete_clip
  const deleteCommands = commands.filter((c) => c.type === 'delete_clip');
  if (deleteCommands.length > 0) {
    warnings.push(
      `${deleteCommands.length} delete_clip command(s) will remove clips from the timeline. ` +
        'They can be undone via the editor undo stack.'
    );
  }

  // 4. Auto-export gating: create_short + reframe produce derivative clips —
  //    they must NOT auto-export without user confirmation.
  const exportCommands = commands.filter((c) => c.type === 'create_short' || c.type === 'reframe');
  if (exportCommands.length > 0) {
    warnings.push(
      `${exportCommands.length} create_short / reframe command(s) will create derivative clips but NOT auto-export. ` +
        'User must explicitly confirm export in the editor UI.'
    );
  }

  // 5. Hard delete-all detection — if delete_clip count >= ctx.clipCount, this is suspicious
  if (ctx.clipCount > 0 && deleteCommands.length >= ctx.clipCount) {
    return {
      safe: false,
      warnings: [
        ...warnings,
        `Refusing to delete ALL ${deleteCommands.length} clip(s) in one batch — this looks like a destructive mistake. ` +
          'Apply clip-by-clip if intentional.',
      ],
    };
  }

  return { safe: warnings.length === 0, warnings };
}
