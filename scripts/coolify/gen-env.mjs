#!/usr/bin/env node
// Builds setup-out/coolify.env for Coolify (Environment Variables → Developer view → paste).
// Usage: pnpm coolify:env -- --domain wizzn.app [--api api.wizzn.app] [--admin admin.wizzn.app] [--media media.wizzn.app]
// Reads credentials from the root .env, generates missing secrets, and keeps generated ones stable across reruns.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a !== '--').reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
if (!args.domain) {
  console.error('Usage: pnpm coolify:env -- --domain <base-domain> [--api host] [--admin host] [--media host]')
  process.exit(1)
}
const host = (k) => args[k] ?? `${k}.${args.domain}`
const API = `https://${host('api')}`
const ADMIN = `https://${host('admin')}`
const MEDIA = `https://${host('media')}`

const parse = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => /^[A-Z0-9_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {}

const OUT = 'setup-out/coolify.env'
const dev = parse('.env')
const prev = parse(OUT)
const secret = (k, bytes) => prev[k] || randomBytes(bytes).toString('base64url')

// Values copied from the root .env when present (credentials, providers)
const COPY = [
  'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY',
  'TTS_PROVIDER', 'TTS_URL', 'TTS_VOICE', 'TTS_LENGTH_SCALE',
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
  POSTGRES_PASSWORD: secret('POSTGRES_PASSWORD', 24),
  BETTER_AUTH_SECRET: secret('BETTER_AUTH_SECRET', 48),
  SEARXNG_SECRET: secret('SEARXNG_SECRET', 32),
}
for (const k of COPY) if (prev[k] ?? dev[k]) env[k] = prev[k] ?? dev[k]
env.STOCK_USER_AGENT ||= `wizzn/1.0 (https://${args.domain}; ops@${args.domain})`

// Sanity checks: dev-only values that won't work on the VPS
const warn = []
const local = /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|host\.docker\.internal/
if (env.LLM_PROVIDER === 'gemini-cli') warn.push('LLM_PROVIDER=gemini-cli needs the gemini binary + its auth (GEMINI_API_KEY) inside the api/worker image')
else if (!env.LLM_BASE_URL || local.test(env.LLM_BASE_URL)) warn.push('LLM_BASE_URL points at a local Ollama — set a hosted OpenAI-compatible endpoint (+ LLM_MODEL, LLM_API_KEY)')
if (env.TTS_PROVIDER && env.TTS_PROVIDER !== 'silent' && local.test(env.TTS_URL ?? '')) warn.push(`TTS_PROVIDER=${env.TTS_PROVIDER} but TTS_URL is local — set TTS_PROVIDER=silent or host a TTS service`)
if (!env.ADMIN_EMAILS) warn.push('ADMIN_EMAILS is empty — nobody can use the admin app')
if (!env.REVENUECAT_WEBHOOK_AUTH) warn.push('REVENUECAT_WEBHOOK_AUTH is empty — purchases webhook disabled')
if (!env.GOOGLE_CLIENT_IDS) warn.push('GOOGLE_CLIENT_IDS is empty — Google sign-in disabled')
if (env.IMAGE_PROVIDER === 'placeholder') warn.push('IMAGE_PROVIDER=placeholder — no AI image fallback')

// Fill required keys so compose interpolation never fails; Coolify shows them for editing
env.LLM_BASE_URL ||= 'https://CHANGE-ME/v1'
env.LLM_MODEL ||= 'CHANGE-ME'
env.ADMIN_EMAILS ||= ''
if (local.test(env.TTS_URL ?? '')) env.TTS_PROVIDER = 'silent'

mkdirSync('setup-out', { recursive: true })
writeFileSync(OUT, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
console.log(`Wrote ${OUT} (${Object.keys(env).length} vars) — paste into Coolify → Environment Variables → Developer view`)
console.log(`Domains to assign in Coolify:\n  api   → ${API}:3000\n  admin → ${ADMIN}\n  media → ${MEDIA}`)
for (const w of warn) console.warn(`⚠ ${w}`)
