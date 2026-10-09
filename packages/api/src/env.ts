import { z } from 'zod'

const csv = z.string().transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGINS: csv.default(''),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().default(''),
  SEARCH_URL: z.string().url(),
  TTS_URL: z.string().url(),
  TTS_VOICE: z.string().min(1),
  IMAGE_PROVIDER: z.enum(['placeholder', 'api']).default('placeholder'),
  MEDIA_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_DIR: z.string().default('./media-data'),
  MEDIA_PUBLIC_URL: z.string().url(),
})
export type Env = z.infer<typeof envSchema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }
  return parsed.data
}
