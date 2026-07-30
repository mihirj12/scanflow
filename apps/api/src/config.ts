import { z } from 'zod';

/**
 * Process environment, parsed once at boot. Failing fast here beats failing
 * halfway through the first request with a missing DATABASE_URL.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /**
   * The single clinic this process serves. Multi-clinic tenancy arrives later;
   * until then every query is scoped to this id.
   */
  CLINIC_ID: z.uuid(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /**
   * HS256 signing key for access tokens. No default: a fallback secret is the
   * kind of thing that reaches production and stays there.
   */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(3600)
    .default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .max(90)
    .default(30),
  /**
   * Absent means no fan-out: the API still works and the UI falls back to
   * polling, so a Redis outage degrades liveness rather than availability.
   */
  REDIS_URL: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid environment: ${detail}`);
  }
  return parsed.data;
}
