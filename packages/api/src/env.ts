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
  // openai = Ollama or any OpenAI-compatible endpoint; gemini-cli = local `gemini` binary (headless);
  // requesty = Requesty router (REQUESTY_API_KEY, LLM_MODEL as provider/model, e.g. google/gemini-2.5-flash)
  LLM_PROVIDER: z.enum(['openai', 'gemini-cli', 'requesty']).default('openai'),
  LLM_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  // gemini-cli: empty = the CLI's default model
  LLM_MODEL: z.string().default(''),
  GEMINI_CLI_BIN: z.string().default('gemini'),
  GEMINI_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  LLM_API_KEY: z.string().default(''),
  SEARCH_URL: z.string().url(),
  /** Requesty router (https://docs.requesty.ai) — used by LLM_PROVIDER=requesty and TTS_PROVIDER=requesty */
  REQUESTY_API_KEY: z.string().default(''),
  REQUESTY_BASE_URL: z.string().url().default('https://router.requesty.ai/v1'),
  /** Speech model for TTS_PROVIDER=requesty (only OpenAI TTS models are routed) */
  REQUESTY_TTS_MODEL: z.string().default('openai/gpt-4o-mini-tts'),
  /**
   * Voice for TTS_PROVIDER=requesty; TTS_VOICE / TTS_VOICE_1..3 are not used by Requesty.
   * openai/* models: alloy|ash|ballad|coral|echo|fable|onyx|nova|sage|shimmer|verse. Other models: passed through as-is
   * (empty = the model's default voice).
   */
  REQUESTY_TTS_VOICE: z.string().default(''),
  /** Language code for non-OpenAI speech models, e.g. `de` for deepinfra/ResembleAI/chatterbox-multilingual */
  REQUESTY_TTS_LANGUAGE: z.string().default(''),
  /** Max chars per request (whole sentences only); 0 = auto (OpenAI 3500, other models 300) */
  REQUESTY_TTS_CHUNK_CHARS: z.coerce.number().int().min(0).max(4096).default(0),
  /** Optional voice steering (tone, accent, pacing); gpt-4o-mini-tts only */
  TTS_INSTRUCTIONS: z.string().default(''),
  TTS_URL: z.string().url().default('http://localhost:5100/synthesize'),
  /** Fixed voice; when empty, each audio unit picks one of TTS_VOICE_1..3 at random */
  TTS_VOICE: z.string().default(''),
  TTS_VOICE_1: z.string().default(''),
  TTS_VOICE_2: z.string().default(''),
  TTS_VOICE_3: z.string().default(''),
  TTS_LENGTH_SCALE: z.coerce.number().min(0.5).max(2).default(1.2),
  TTS_PROVIDER: z.enum(['silent', 'piper', 'chatterbox', 'qwen', 'requesty']).default('silent'),
  IMAGE_PROVIDER: z.enum(['placeholder', 'api']).default('placeholder'),
  IMAGE_BASE_URL: z.string().url().optional(),
  IMAGE_MODEL: z.string().optional(),
  IMAGE_API_KEY: z.string().default(''),
  ADMIN_EMAILS: csv.default(''),
  MEDIA_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_DIR: z.string().default('./media-data'),
  /** MEDIA_DRIVER=s3: S3-compatible endpoint (self-hosted Garage), path-style */
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('garage'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
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
  /** Issue #4: knowledge sources; tier decides the order, omit `web` to disable the open-web fallback */
  RESEARCH_PROVIDERS: csv.pipe(z.array(z.enum(['curated', 'wikipedia', 'europepmc', 'web']))).default('curated,wikipedia,europepmc,web'),
  /** Fewer usable sources from tiers 1–3 → open-web fallback */
  RESEARCH_MIN_SOURCES: z.coerce.number().int().min(0).default(2),
  /** ImageRouter b64_ephemeral: no 30-day retention at the provider */
  IMAGE_EPHEMERAL: bool(true),
}).superRefine((env, ctx) => {
  if (env.MEDIA_DRIVER === 's3') {
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key].trim()) ctx.addIssue({ code: 'custom', path: [key], message: 'required when MEDIA_DRIVER is s3' })
    }
  }
  if ((env.LLM_PROVIDER === 'requesty' || env.TTS_PROVIDER === 'requesty') && !env.REQUESTY_API_KEY.trim()) {
    ctx.addIssue({ code: 'custom', path: ['REQUESTY_API_KEY'], message: 'required when LLM_PROVIDER or TTS_PROVIDER is requesty' })
  }
  if (env.STOCK_IMAGE_PROVIDERS.includes('commons') && !env.STOCK_USER_AGENT.trim()) {
    ctx.addIssue({ code: 'custom', path: ['STOCK_USER_AGENT'], message: 'required when STOCK_IMAGE_PROVIDERS includes commons' })
  }
  // Wikimedia API policy: unidentified clients are throttled to 10 req/min
  if (env.RESEARCH_PROVIDERS.includes('wikipedia') && !env.STOCK_USER_AGENT.trim()) {
    ctx.addIssue({ code: 'custom', path: ['STOCK_USER_AGENT'], message: 'required when RESEARCH_PROVIDERS includes wikipedia' })
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
