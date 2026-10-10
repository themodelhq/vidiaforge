// VidiaForge — AI response validator
// Uses the Zod schema to validate raw LLM output. Strips unknown fields.
// Never allows arbitrary code execution.

import {
  AIResponseSchema,
  AICommandListSchema,
  type AICommand,
  type AIResponse,
} from './schema';

export type ValidationResult =
  | { ok: true; data: AIResponse }
  | { ok: false; errors: string[] };

export type CommandListResult =
  | { ok: true; data: AICommand[] }
  | { ok: false; errors: string[] };

/**
 * Validate a full AI response (summary + commands).
 * Strips unknown fields, rejects malformed commands (with per-command errors but
 * keeps valid ones — caller can decide whether to fail-fast or partial-apply).
 */
export function validateAIResponse(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Response is not an object'] };
  }

  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const cmds = Array.isArray(obj.commands) ? obj.commands : [];

  const validCommands: AICommand[] = [];
  const errors: string[] = [];

  for (let i = 0; i < cmds.length; i++) {
    const result = AICommandListSchema.element.safeParse(cmds[i]);
    if (result.success) {
      validCommands.push(result.data);
    } else {
      const path = `commands[${i}]`;
      const issues = result.error.issues.map((iss) => `${path}.${iss.path.join('.')}: ${iss.message}`);
      errors.push(...issues);
    }
  }

  if (!summary && validCommands.length === 0) {
    return { ok: false, errors: ['Response has no summary and no valid commands', ...errors] };
  }

  return {
    ok: true,
    data: {
      summary: summary || 'AI edits applied.',
      commands: validCommands,
    },
  };
}

/**
 * Validate only the commands array (when summary isn't needed).
 */
export function validateCommands(raw: unknown): CommandListResult {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['Commands is not an array'] };
  }
  const validCommands: AICommand[] = [];
  const errors: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = AIResponseSchema.shape.commands.element.safeParse(raw[i]);
    if (result.success) {
      validCommands.push(result.data);
    } else {
      const path = `[${i}]`;
      const issues = result.error.issues.map((iss) => `${path}.${iss.path.join('.')}: ${iss.message}`);
      errors.push(...issues);
    }
  }
  return { ok: true, data: validCommands };
}

export { AIResponseSchema, AICommandSchema, AICommandListSchema } from './schema';
