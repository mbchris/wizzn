#!/usr/bin/env node
// Builds setup-out/coolify.env for Coolify (Environment Variables → Developer view → paste).
// Usage: pnpm coolify:env -- --domain wizzn.app [--api api.wizzn.app] [--admin admin.wizzn.app] [--media media.wizzn.app] [--fresh-secrets]
// The output is deleted and rebuilt on every run from the root .env, with keys set in .env.production taking priority. Only the generated secrets are carried over
// (rotating POSTGRES_PASSWORD would lock the api out of the existing DB volume); --fresh-secrets regenerates them too.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const FLAGS = new Set(['fresh-secrets'])
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!a.startsWith('--') || a === '--') continue
  const k = a.slice(2)
  args[k] = FLAGS.has(k) ? true : process.argv[++i]
}
if (!args.domain) {
  console.error('Usage: pnpm coolify:env -- --domain <base-domain> [--api host] [--admin host] [--media host] [--fresh-secrets]')
  process.exit(1)
}
const host = (k) => args[k] ?? `${k}.${args.domain}`
const API = `https://${host('api')}`
const ADMIN = `https://${host('admin')}`
const MEDIA = `https://${host('media')}`

// KEY=value per line; tolerates `export `, surrounding quotes and CRLF. Duplicate keys: the last one wins (like dotenv).
const parse = (file) => {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const OUT = 'setup-out/coolify.env'
// .env.production overrides .env key by key (only keys that are set there with a non-empty value)
const base = parse('.env')
const prod = Object.fromEntries(Object.entries(parse('.env.production')).filter(([, v]) => v !== ''))
const dev = { ...base, ...prod }
const SECRETS = ['POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET', 'SEARXNG_SECRET']
const prev = args['fresh-secrets'] ? {} : parse(OUT)
rmSync(OUT, { force: true })
const secret = (k, bytes) => prev[k] || randomBytes(bytes).toString('base64url')

// Values copied from .env / .env.production when set (credentials, providers). Must also be listed in docker-compose.yml x-api-env.
const COPY = [
  'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY',
  'REQUESTY_API_KEY', 'REQUESTY_BASE_URL', 'REQUESTY_TTS_MODEL', 'REQUESTY_TTS_VOICE', 'REQUESTY_TTS_LANGUAGE', 'REQUESTY_TTS_CHUNK_CHARS',
  'TTS_PROVIDER', 'TTS_URL', 'TTS_VOICE', 'TTS_VOICE_1', 'TTS_VOICE_2', 'TTS_VOICE_3', 'TTS_LENGTH_SCALE', 'TTS_INSTRUCTIONS',
  'IMAGE_PROVIDER', 'IMAGE_BASE_URL', 'IMAGE_MODEL', 'IMAGE_API_KEY', 'IMAGE_EPHEMERAL',
  'STOCK_IMAGE_PROVIDERS', 'STOCK_USER_AGENT', 'OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET', 'STOCK_MIN_EDGE_PX', 'STOCK_MAX_BYTES',
  'RESEARCH_PROVIDERS', 'RESEARCH_MIN_SOURCES', 'FREE_DAILY_CAP', 'ADMIN_EMAILS',
  'REVENUECAT_WEBHOOK_AUTH', 'REVENUECAT_SECRET_KEY',
  'APPLE_APP_BUNDLE_ID', 'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET', 'GOOGLE_CLIENT_IDS', 'GOOGLE_CLIENT_SECRET',
]

const env = {
  API_PUBLIC_URL: API,
  MEDIA_PUBLIC_URL: MEDIA,
  CORS_ORIGINS: [ADMIN, 'capacitor://localhost', 'http://localhost', 'https://localhost'].join(','),
}
for (const k of SECRETS) env[k] = secret(k, k === 'BETTER_AUTH_SECRET' ? 48 : k === 'POSTGRES_PASSWORD' ? 24 : 32)
for (const k of COPY) if (dev[k]) env[k] = dev[k]
env.STOCK_USER_AGENT ||= `wizzn/1.0 (https://${args.domain}; ops@${args.domain})`

// Sanity checks: dev-only values that won't work on the VPS
const warn = []
const local = /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|host\.docker\.internal/
const llm = env.LLM_PROVIDER || 'openai'
if (llm === 'gemini-cli') warn.push('LLM_PROVIDER=gemini-cli needs the gemini binary + its auth (GEMINI_API_KEY) inside the api/worker image')
else if (llm === 'requesty') {
  if (!env.LLM_MODEL) warn.push('LLM_PROVIDER=requesty needs LLM_MODEL (provider/model)')
} else if (!env.LLM_BASE_URL || local.test(env.LLM_BASE_URL)) warn.push('LLM_BASE_URL points at a local Ollama — set a hosted OpenAI-compatible endpoint (+ LLM_MODEL, LLM_API_KEY)')

// Only piper/chatterbox/qwen talk to TTS_URL; requesty/silent ignore it
const tts = env.TTS_PROVIDER || 'silent'
const usesTtsUrl = ['piper', 'chatterbox', 'qwen'].includes(tts)
if (usesTtsUrl && local.test(env.TTS_URL ?? '')) {
  warn.push(`TTS_PROVIDER=${tts} but TTS_URL is local — falling back to TTS_PROVIDER=silent (host a TTS service or use requesty)`)
  env.TTS_PROVIDER = 'silent'
}
if (env.TTS_PROVIDER !== 'piper' && env.TTS_PROVIDER !== 'chatterbox' && env.TTS_PROVIDER !== 'qwen') {
  for (const k of ['TTS_URL', 'TTS_VOICE', 'TTS_VOICE_1', 'TTS_VOICE_2', 'TTS_VOICE_3']) delete env[k]
}
if (env.TTS_PROVIDER !== 'requesty' && llm !== 'requesty') {
  for (const k of Object.keys(env)) if (k.startsWith('REQUESTY_')) delete env[k]
} else if (!env.REQUESTY_API_KEY) warn.push('REQUESTY_API_KEY is empty — required for LLM_PROVIDER/TTS_PROVIDER=requesty (api will refuse to start)')

if (!env.ADMIN_EMAILS) warn.push('ADMIN_EMAILS is empty — nobody can use the admin app')
if (!env.REVENUECAT_WEBHOOK_AUTH) warn.push('REVENUECAT_WEBHOOK_AUTH is empty — purchases webhook disabled')
if (!env.GOOGLE_CLIENT_IDS) warn.push('GOOGLE_CLIENT_IDS is empty — Google sign-in disabled')
if (env.IMAGE_PROVIDER === 'placeholder') warn.push('IMAGE_PROVIDER=placeholder — no AI image fallback')
// .env keys the api reads (packages/api/src/env.ts) that this script doesn't carry over — compose sets the infra ones itself
const API_KEYS = existsSync('packages/api/src/env.ts')
  ? new Set([...readFileSync('packages/api/src/env.ts', 'utf8').matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]))
  : new Set()
const SKIP = /^(DATABASE_URL|SEARCH_URL|MEDIA_|BETTER_AUTH_URL|PORT|NODE_ENV|CORS_ORIGINS|TTS_DEBUG_TEXT|GEMINI_CLI_)/
const ignored = Object.keys(dev).filter((k) => API_KEYS.has(k) && !COPY.includes(k) && !SECRETS.includes(k) && !SKIP.test(k))
if (ignored.length) warn.push(`not copied from .env/.env.production (add to COPY + docker-compose.yml if prod needs them): ${ignored.join(', ')}`)

// Fill required keys so compose interpolation never fails; Coolify shows them for editing
if (llm === 'openai') env.LLM_BASE_URL ||= 'https://CHANGE-ME/v1'
env.LLM_MODEL ||= 'CHANGE-ME'
env.ADMIN_EMAILS ||= ''

mkdirSync('setup-out', { recursive: true })
writeFileSync(OUT, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
console.log(`Wrote ${OUT} (${Object.keys(env).length} vars${args['fresh-secrets'] ? ', NEW secrets' : ''}) — paste into Coolify → Environment Variables → Developer view`)
const fromProd = COPY.filter((k) => k in env && k in prod && prod[k] !== base[k])
if (fromProd.length) console.log(`From .env.production (overriding .env): ${fromProd.join(', ')}`)
const prodSecrets = SECRETS.filter((k) => prod[k] && prod[k] !== env[k])
if (prodSecrets.length) console.log(`Ignored in .env.production (generated, kept stable): ${prodSecrets.join(', ')}`)
console.log(`Domains to assign in Coolify:\n  api   → ${API}:3000\n  admin → ${ADMIN}\n  media → ${MEDIA}`)
for (const w of warn) console.warn(`⚠ ${w}`)
