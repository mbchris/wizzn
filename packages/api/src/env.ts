import { z } from 'zod'
import { lanIPv4s } from './devOrigins.js'
import { DEFAULT_FREE_DAILY_CAP } from '@wizzn/shared'

const csv = z.string().transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))

const bool = (def: boolean) =>
  z.preprocess((v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v), z.boolean().default(def))

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
  TTS_LENGTH_SCALE: z.coerce.number().min(0.5).max(2).default(1.2),
  TTS_PROVIDER: z.enum(['silent', 'piper']).default('silent'),
  IMAGE_PROVIDER: z.enum(['placeholder', 'api']).default('placeholder'),
  IMAGE_BASE_URL: z.string().url().optional(),
  IMAGE_MODEL: z.string().optional(),
  IMAGE_API_KEY: z.string().default(''),
  ADMIN_EMAILS: csv.default(''),
  MEDIA_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_DIR: z.string().default('./media-data'),
  // 'auto' (dev): http://<current LAN IP>:8081 → media loads in browser, emulator and phone alike
  MEDIA_PUBLIC_URL: z.preprocess(
    (v) => (v === 'auto' ? `http://${lanIPv4s()[0] ?? 'localhost'}:8081` : v),
    z.string().url(),
  ),
  // M4 — monetisation & sign-in (all optional in dev)
  FREE_DAILY_CAP: z.coerce.number().int().min(1).default(DEFAULT_FREE_DAILY_CAP),
  /** Exact Authorization header value configured for the RevenueCat webhook */
  REVENUECAT_WEBHOOK_AUTH: z.string().default(''),
  /** RevenueCat secret API key (v1) used to refresh entitlements right after a purchase */
  REVENUECAT_SECRET_KEY: z.string().default(''),
  /** Bundle id of the iOS app; enables Sign in with Apple (native id tokens) when set */
  APPLE_APP_BUNDLE_ID: z.string().default(''),
  /** Services ID + client secret JWT, only needed for the web redirect flow */
  APPLE_CLIENT_ID: z.string().default(''),
  APPLE_CLIENT_SECRET: z.string().default(''),
  /** Comma-separated OAuth client ids: web first, then iOS and Android (all accepted as id token audience) */
  GOOGLE_CLIENT_IDS: csv.default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** CC-licensed stock images: provider order; empty disables stock */
  STOCK_IMAGE_PROVIDERS: csv.pipe(z.array(z.enum(['openverse', 'commons']))).default('openverse,commons'),
  /** Required when `commons` is enabled, e.g. "wizzn/1.0 (https://wizzn.app; ops@wizzn.app)" */
  STOCK_USER_AGENT: z.string().default(''),
  OPENVERSE_CLIENT_ID: z.string().default(''),
  OPENVERSE_CLIENT_SECRET: z.string().default(''),
  STOCK_MIN_EDGE_PX: z.coerce.number().int().positive().default(800),
  STOCK_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
  /** ImageRouter b64_ephemeral: no 30-day retention at the provider */
  IMAGE_EPHEMERAL: bool(true),
}).superRefine((env, ctx) => {
  if (env.STOCK_IMAGE_PROVIDERS.includes('commons') && !env.STOCK_USER_AGENT.trim()) {
    ctx.addIssue({ code: 'custom', path: ['STOCK_USER_AGENT'], message: 'required when STOCK_IMAGE_PROVIDERS includes commons' })
  }
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
