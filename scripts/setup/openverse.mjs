#!/usr/bin/env node
// Registers an Openverse API application (OAuth2 client_credentials) and stores the credentials in .env.
//   → OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET (used by packages/api stock-image provider).
// Openverse shows client_secret only once, so it is written to .env immediately (run `pnpm creds:push` after).
// Skips if credentials already exist; pass --force to register a new app anyway.
// Inputs (.env or flags): OPENVERSE_APP_NAME (--name), OPENVERSE_APP_DESCRIPTION (--description), OPENVERSE_EMAIL (--email)
// Usage: pnpm setup:openverse [--name ..] [--description ..] [--email ..] [--force]
import { parseArgs } from 'node:util'
import { info, ok, warn, manual, printManual, upsertEnv } from './lib.mjs'

const BASE = (process.env.OPENVERSE_BASE_URL || 'https://api.openverse.org').replace(/\/$/, '')
const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    description: { type: 'string' },
    email: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
})

if (process.env.OPENVERSE_CLIENT_ID && process.env.OPENVERSE_CLIENT_SECRET && !args.force) {
  ok('OPENVERSE_CLIENT_ID/SECRET already set in .env — nothing to do (use --force to register a new app)')
  process.exit(0)
}

const name = args.name || process.env.OPENVERSE_APP_NAME || `${process.env.APP_NAME || 'wizzn'} stock images`
const description = args.description || process.env.OPENVERSE_APP_DESCRIPTION ||
  'wizzn is a short-form learning app ("like Instagram or TikTok, but for knowledge"). ' +
  'Our content pipeline searches Openverse for CC-licensed images to illustrate learning units, ' +
  'storing attribution (creator, license, source URL) alongside each image. ' +
  'Server-side only, low volume: a few searches per generated unit.'
const email = args.email || process.env.OPENVERSE_EMAIL

const errors = []
if (!email) errors.push('email missing: set OPENVERSE_EMAIL in .env or pass --email')
else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`invalid email: ${email}`)
if (name.length > 150) errors.push(`name too long (${name.length} > 150)`)
if (description.length > 10000) errors.push(`description too long (${description.length} > 10000)`)
if (errors.length) { errors.forEach((e) => console.error(`\x1b[1;31m✗ ${e}\x1b[0m`)); process.exit(1) }

info(`Registering Openverse app "${name}" (${email})`)
const res = await fetch(`${BASE}/v1/auth_tokens/register/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ name, description, email }),
})
const text = await res.text()
let body = {}
try { body = text ? JSON.parse(text) : {} } catch { /* non-JSON error page */ }
if (!res.ok || !body.client_id || !body.client_secret) {
  console.error(`\x1b[1;31m✗ register → HTTP ${res.status}: ${text.slice(0, 500)}\x1b[0m`)
  if (res.status === 400 && /name/i.test(text)) warn('Name must be unique on Openverse — pass a different --name')
  process.exit(1)
}
ok(`registered (client_id ${body.client_id})`)
upsertEnv({ OPENVERSE_CLIENT_ID: body.client_id, OPENVERSE_CLIENT_SECRET: body.client_secret })

// Sanity check: exchange credentials for a token
const tok = await fetch(`${BASE}/v1/auth_tokens/token/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: body.client_id, client_secret: body.client_secret }),
})
if (tok.ok) ok('token exchange works')
else warn(`token exchange → HTTP ${tok.status} (may work once the email is verified)`)

manual(`Click the verification link Openverse sent to ${email} — until then the app has anonymous rate limits`)
manual('Back up the new secret: pnpm creds:push (Openverse cannot show client_secret again)')
printManual('Openverse')
