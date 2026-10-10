#!/usr/bin/env node
// Generates the Sign in with Apple client secret (ES256 JWT) Better Auth needs as APPLE_CLIENT_SECRET.
// Apple caps validity at 6 months → re-run before expiry (date is printed). Usage: pnpm setup:apple:secret
import { ok, need, upsertEnv } from './lib.mjs'
import { es256Jwt } from './asc.mjs'

need('APPLE_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_KEY_PATH', 'APP_ID')
const clientId = process.env.APPLE_SERVICES_ID || process.env.APP_ID
const now = Math.floor(Date.now() / 1000)
const exp = now + 180 * 24 * 3600 - 60
const secret = es256Jwt({
  keyPath: process.env.APPLE_SIWA_KEY_PATH, keyId: process.env.APPLE_SIWA_KEY_ID,
  payload: { iss: process.env.APPLE_TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: clientId },
})
upsertEnv({
  APPLE_APP_BUNDLE_ID: process.env.APP_ID,
  APPLE_CLIENT_ID: process.env.APPLE_SERVICES_ID,
  APPLE_CLIENT_SECRET: secret,
})
ok(`client secret for ${clientId} valid until ${new Date(exp * 1000).toISOString().slice(0, 10)} — renew before then`)
