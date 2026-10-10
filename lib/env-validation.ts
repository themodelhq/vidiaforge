// VidiaForge — Central environment validation layer.
// Validates required environment variables at startup.
// Throws clear errors for missing production configuration.

export type Env = 'development' | 'test' | 'production';

export function getEnv(): Env {
  return (process.env.NODE_ENV as Env) || 'development';
}

export function isProduction(): boolean {
  return getEnv() === 'production';
}

interface EnvVarSpec {
  name: string;
  required: boolean;
  category: 'DATABASE' | 'REDIS' | 'STORAGE' | 'AUTH' | 'AI' | 'TRANSCRIPTION' | 'TRANSLATION' | 'CORS' | 'APP';
  description: string;
  sensitive?: boolean;
}

const ENV_SPECS: EnvVarSpec[] = [
  // Database
  { name: 'DATABASE_URL', required: true, category: 'DATABASE', description: 'PostgreSQL connection URL', sensitive: true },
  // Redis
  { name: 'REDIS_URL', required: false, category: 'REDIS', description: 'Redis connection URL (required for worker + render queue)', sensitive: true },
  // Storage
  { name: 'STORAGE_PROVIDER', required: false, category: 'STORAGE', description: 'Storage provider: local | s3 | r2 (defaults to local in dev, required in production)' },
  { name: 'STORAGE_ENDPOINT', required: false, category: 'STORAGE', description: 'S3-compatible endpoint URL', sensitive: true },
  { name: 'STORAGE_BUCKET', required: false, category: 'STORAGE', description: 'S3-compatible bucket name' },
  { name: 'STORAGE_REGION', required: false, category: 'STORAGE', description: 'S3 region' },
  { name: 'STORAGE_ACCESS_KEY', required: false, category: 'STORAGE', description: 'S3 access key ID', sensitive: true },
  { name: 'STORAGE_SECRET_KEY', required: false, category: 'STORAGE', description: 'S3 secret access key', sensitive: true },
  { name: 'UPLOAD_DIR', required: false, category: 'STORAGE', description: 'Local upload directory (when STORAGE_PROVIDER=local)' },
  // Auth
  { name: 'SESSION_SECRET', required: false, category: 'AUTH', description: 'Session signing secret', sensitive: true },
  // AI
  { name: 'AI_PROVIDER', required: false, category: 'AI', description: 'AI provider: zai | openai | anthropic | gemini' },
  // Transcription
  { name: 'TRANSCRIPTION_PROVIDER', required: false, category: 'TRANSCRIPTION', description: 'Transcription provider: openai | deepgram | local' },
  { name: 'TRANSCRIPTION_API_KEY', required: false, category: 'TRANSCRIPTION', description: 'Transcription API key', sensitive: true },
  // Translation
  { name: 'TRANSLATION_PROVIDER', required: false, category: 'TRANSLATION', description: 'Translation provider' },
  // CORS
  { name: 'CORS_ORIGIN', required: false, category: 'CORS', description: 'Allowed CORS origin(s)' },
  // App
  { name: 'NEXT_PUBLIC_API_URL', required: false, category: 'APP', description: 'Public API URL (for frontend)' },
  { name: 'NEXT_PUBLIC_APP_NAME', required: false, category: 'APP', description: 'Application name' },
  // Worker
  { name: 'WORKER_CONCURRENCY', required: false, category: 'APP', description: 'Worker concurrency limit (default 2)' },
];

export interface EnvValidationResult {
  valid: boolean;
  env: Env;
  errors: string[];
  warnings: string[];
  config: Record<string, { set: boolean; category: string; sensitive: boolean }>;
}

export function validateEnv(): EnvValidationResult {
  const env = getEnv();
  const errors: string[] = [];
  const warnings: string[] = [];
  const config: Record<string, { set: boolean; category: string; sensitive: boolean }> = {};

  for (const spec of ENV_SPECS) {
    const value = process.env[spec.name];
    const isSet = !!value && value.trim().length > 0;
    config[spec.name] = { set: isSet, category: spec.category, sensitive: !!spec.sensitive };

    if (spec.required && !isSet) {
      errors.push(`[env] FATAL: ${spec.name} is required (${spec.description})`);
    } else if (!isSet && spec.category === 'STORAGE' && spec.name === 'STORAGE_PROVIDER') {
      // Default to local for development
      if (env !== 'production') {
        warnings.push(`[env] ${spec.name} not set — defaulting to "local" (development only)`);
      }
    } else if (!isSet && spec.category === 'REDIS') {
      warnings.push(`[env] ${spec.name} not set — render queue will be unavailable`);
    } else if (!isSet && spec.category === 'TRANSCRIPTION') {
      warnings.push(`[env] ${spec.name} not set — transcription will be unavailable`);
    }
  }

  // Production-specific checks
  if (env === 'production') {
    if (process.env.STORAGE_PROVIDER === 'local') {
      errors.push('[env] FATAL: STORAGE_PROVIDER=local is not allowed in production. Use s3 or r2.');
    }
    if (!process.env.REDIS_URL) {
      errors.push('[env] FATAL: REDIS_URL is required in production for the render queue.');
    }
  }

  return {
    valid: errors.length === 0,
    env,
    errors,
    warnings,
    config,
  };
}

/** Safe env getter that never logs the value of sensitive vars */
export function getEnvStatus(): Record<string, { set: boolean; category: string }> {
  const result: Record<string, { set: boolean; category: string }> = {};
  for (const spec of ENV_SPECS) {
    result[spec.name] = {
      set: !!process.env[spec.name],
      category: spec.category,
    };
  }
  return result;
}
