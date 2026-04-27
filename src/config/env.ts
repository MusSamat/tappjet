import { z } from 'zod';

// Load `.env` into process.env before Zod parses (Node ≥20.12 built-in).
// In production a process manager (Docker / systemd) passes env directly, so
// we only load if the file exists and the key isn't already set by the runner.
try {
  process.loadEnvFile?.('.env');
} catch {
  // Missing .env is fine — CI and prod pass env directly.
}

// Validate all environment variables up-front. A missing required var fails fast
// at startup rather than surfacing as a runtime 500 deep inside a handler.

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be ≥32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be ≥32 chars'),
  JWT_ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  // TZ v2.1: no fixed refresh TTL — extends on activity. 30 days of inactivity
  // = forced logout. Cleanup cron enforces the deadline via expires_at.
  JWT_REFRESH_INACTIVITY_DAYS: z.coerce.number().int().positive().default(30),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default('tappjet_bot'),

  // OAuth — audience / client IDs to match in verified JWTs. Comma-separated
  // so the Flutter app and the Web client can use different client ids.
  GOOGLE_CLIENT_IDS: z.string().default('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'),
  APPLE_CLIENT_IDS: z.string().default(''),

  SMS_PROVIDER: z.enum(['mock', 'mega', 'nikita']).default('mock'),
  SMS_API_URL: z.string().default(''),
  SMS_API_LOGIN: z.string().default(''),
  SMS_API_PASSWORD: z.string().default(''),
  SMS_SENDER: z.string().default('Tappjet'),

  SUPERADMIN_EMAIL: z.string().email().default('superadmin@tappjet.kg'),
  SUPERADMIN_TEMP_PASSWORD: z.string().min(8).default('change-on-first-login-please'),

  FILES_DIR: z.string().default('./var/files'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(5),

  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Comma-separated list of allowed CORS origins in production.
  // Dev always allows localhost:3000 and localhost:3001 automatically.
  ALLOWED_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Don't leak secrets — show only which keys failed.
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Use stderr directly — logger isn't initialised yet.
    process.stderr.write(`\n✗ Invalid environment variables:\n${issues}\n\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = parseEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';
