#!/usr/bin/env node
// Walks through closing out M4: automated checks, API smoke test, browser + device checklists, commit.
// Usage: pnpm verify:m4 [all|auto|db|smoke|browser|device|commit]   (default: all)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'http://localhost:3000'
const API_ENV = join(ROOT, 'packages/api/.env')
const CAP_DIR = join(ROOT, 'packages/web/src-capacitor')
const WEBHOOK_AUTH = 'Bearer verify-m4'
const COMMIT_MSG = 'feat(m4): streaks, XP, badges, weekly goal, daily cap, paywall + RevenueCat, Apple/Google sign-in'

const rl = createInterface({ input: process.stdin, output: process.stdout })
const results = []
const c = { h: (s) => `\x1b[1;35m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` }

const section = (t) => console.log(`\n${c.h(`━━ ${t} ━━`)}`)
const record = (name, ok, note = '') => {
  results.push({ name, ok, note })
  console.log(`${ok ? c.ok('✓') : c.bad('✗')} ${name}${note ? c.dim(`  ${note}`) : ''}`)
  return ok
}
const ask = async (q) => (await rl.question(`${c.y('?')} ${q} [y/N] `)).trim().toLowerCase().startsWith('y')
const input = async (q, def = '') => (await rl.question(`${c.y('?')} ${q}${def ? c.dim(` (${def})`) : ''}: `)).trim() || def
const run = (cmd, args, opts = {}) => {
  console.log(c.dim(`$ ${cmd} ${args.join(' ')}`))
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts }).status === 0
}
const runQuiet = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts })

/** Manual checklist: each item is confirmed by you */
async function checklist(title, items) {
  console.log(c.dim(`\n${title}`))
  for (const item of items) record(item, await ask(item))
}

// ---------------------------------------------------------------- env
const M4_ENV = {
  FREE_DAILY_CAP: '3',
  REVENUECAT_WEBHOOK_AUTH: '',
  REVENUECAT_SECRET_KEY: '',
  APPLE_APP_BUNDLE_ID: 'app.fourki.wizzn',
  APPLE_CLIENT_ID: '',
  APPLE_CLIENT_SECRET: '',
  GOOGLE_CLIENT_IDS: '',
  GOOGLE_CLIENT_SECRET: '',
}

async function stepEnv() {
  section('0 · Environment')
  for (const [cmd, hint] of [['pnpm', 'corepack enable'], ['docker', 'start Docker Desktop'], ['node', 'install Node ≥ 20']]) {
    record(`${cmd} available`, runQuiet('which', [cmd]).status === 0, hint)
  }
  if (!existsSync(API_ENV)) return record('packages/api/.env exists', false, 'cp .env.api.template packages/api/.env')
  const text = readFileSync(API_ENV, 'utf8')
  const missing = Object.keys(M4_ENV).filter((k) => !new RegExp(`^${k}=`, 'm').test(text))
  if (!missing.length) return record('M4 env vars in packages/api/.env', true)
  console.log(`Missing in packages/api/.env: ${missing.join(', ')}`)
  if (await ask('Append them with defaults?')) {
    appendFileSync(API_ENV, `\n# M4 (added by verify-m4)\n${missing.map((k) => `${k}=${M4_ENV[k]}`).join('\n')}\n`)
    record('M4 env vars appended', true)
  } else record('M4 env vars in packages/api/.env', false)
  // .env.api.template could not be written by the agent; keep it in sync for fresh clones
  const tplPath = join(ROOT, '.env.api.template')
  if (existsSync(tplPath) && !/FREE_DAILY_CAP=/.test(readFileSync(tplPath, 'utf8')) && (await ask('Also add the M4 block to .env.api.template?'))) {
    appendFileSync(tplPath, `\n# M4 — free tier, subscriptions, sign-in (all optional in dev)\n${Object.entries(M4_ENV).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
    record('.env.api.template updated', true)
  }
}

// ---------------------------------------------------------------- automated
async function stepAuto() {
  section('1 · Install, typecheck, tests')
  if (existsSync(join(ROOT, '.tmp-m4'))) run('rm', ['-rf', '.tmp-m4'])
  record('pnpm install', run('pnpm', ['install']))
  record('pnpm typecheck', run('pnpm', ['typecheck']))
  record('pnpm test', run('pnpm', ['test']))
}

// ---------------------------------------------------------------- db
async function stepDb() {
  section('2 · Database')
  record('docker compose (dev) up', run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait']))
  record('db:migrate (applies 0002_m4_streak_freezes)', run('pnpm', ['db:migrate']))
  run('pnpm', ['db:generate'])
  const untracked = runQuiet('git', ['status', '--porcelain', 'packages/api/drizzle']).stdout
    .split('\n').filter((l) => l.startsWith('??') && !l.includes('0002_m4'))
  record('db:generate created no new migration (hand-written 0002 matches schema)', untracked.length === 0, untracked.join(' '))
  record('db:seed', run('pnpm', ['db:seed']))
  record('db:seed:samples (published units for the feed)', run('pnpm', ['db:seed:samples']))
}

// ---------------------------------------------------------------- api smoke
async function http(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const completionBody = (u) =>
  u.content.format === 'written'
    ? { format: 'written', slidesSeen: u.content.slides.length, dwellSec: 20 }
    : { format: 'audio', listenedSec: u.content.durationSec }

async function waitForApi(ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(`${API}/health`)).ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function stepSmoke() {
  section('3 · API smoke test (cap = 2, fake RevenueCat webhook)')
  if (await waitForApi(1000)) {
    console.log(c.bad('Something already runs on :3000 – stop `pnpm dev` first (the smoke test needs its own env).'))
    return record('API smoke test', false, 'port 3000 busy')
  }
  const api = spawn('pnpm', ['dev'], { cwd: ROOT, env: { ...process.env, FREE_DAILY_CAP: '2', REVENUECAT_WEBHOOK_AUTH: WEBHOOK_AUTH }, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
  try {
    if (!record('API starts', await waitForApi())) return
    const signIn = await http('/api/auth/sign-in/anonymous', { method: 'POST', body: {} })
    const token = signIn.json?.token
    if (!record('anonymous session', Boolean(token), `status ${signIn.status}`)) return
    const me = (await http('/api/me', { token })).json
    const fields = (await http('/api/fields')).json ?? []
    await http('/api/me/interests', { method: 'PUT', token, body: { fieldIds: fields.map((f) => f.id), themeIds: [], formats: ['audio', 'written'], timezone: 'Europe/Berlin' } })

    const feed = (await http('/api/feed', { token })).json
    if (!record('feed has ≥ 3 units', (feed?.units?.length ?? 0) >= 3, `${feed?.units?.length ?? 0} units – run db:seed:samples`)) return
    record('feed reports cap 0/2', feed.cap?.limit === 2 && feed.cap?.done === 0)
    const [u1, u2, u3] = feed.units

    const r1 = (await http(`/api/units/${u1.id}/complete`, { method: 'POST', token, body: completionBody(u1) })).json
    record('1st unit: +15 XP (10 + first of day)', r1?.rewards?.xpGained === 15, JSON.stringify(r1?.rewards?.xp))
    record('1st unit: streak 1', r1?.rewards?.streak === 1)
    record('1st unit: badge first_unit', r1?.rewards?.newBadges?.includes('first_unit'))
    const again = (await http(`/api/units/${u1.id}/complete`, { method: 'POST', token, body: completionBody(u1) })).json
    record('same unit again: no rewards', again?.firstTime === false && !again?.rewards)

    const r2 = (await http(`/api/units/${u2.id}/complete`, { method: 'POST', token, body: completionBody(u2) })).json
    record('2nd unit: +10 XP', r2?.rewards?.xpGained === 10)
    record('2nd unit: cap reached', r2?.rewards?.cap?.reached === true)

    const capped = (await http('/api/feed', { token })).json
    record('feed after cap: no units, cap.reached', capped?.units?.length === 0 && capped?.cap?.reached === true)
    const r3 = await http(`/api/units/${u3.id}/complete`, { method: 'POST', token, body: completionBody(u3) })
    record('3rd unit: 402 daily_cap', r3.status === 402 && r3.json?.reason === 'daily_cap')

    const p = (await http('/api/me/progress', { token })).json
    record('progress: 25 XP, week 2/5, streak 1', p?.level?.totalXp === 25 && p?.week?.done === 2 && p?.streak?.current === 1, JSON.stringify({ xp: p?.level?.totalXp, week: p?.week, streak: p?.streak?.current }))

    const purchase = { event: { type: 'INITIAL_PURCHASE', app_user_id: me.id, product_id: 'wizzn_monthly', entitlement_ids: ['premium'], expiration_at_ms: Date.now() + 30 * 86_400_000 } }
    const bad = await http('/api/webhooks/revenuecat', { method: 'POST', body: purchase, headers: { authorization: 'Bearer wrong' } })
    record('webhook: wrong secret → 401', bad.status === 401)
    const good = await http('/api/webhooks/revenuecat', { method: 'POST', body: purchase, headers: { authorization: WEBHOOK_AUTH } })
    record('webhook: purchase applied', good.json?.applied === true)
    const premium = (await http('/api/me/progress', { token })).json
    record('progress: premium active, no cap', premium?.premium?.active === true && premium?.cap?.limit === null)
    const unlocked = (await http('/api/feed', { token })).json
    record('feed after premium: units again', (unlocked?.units?.length ?? 0) > 0)
  } catch (e) {
    record('API smoke test', false, String(e))
  } finally {
    try {
      process.kill(-api.pid, 'SIGTERM')
    } catch {}
  }
}

// ---------------------------------------------------------------- browser
async function stepBrowser() {
  section('4 · Browser check')
  console.log(`In two terminals run:
  ${c.y('FREE_DAILY_CAP=2 pnpm dev')}
  ${c.y('pnpm dev:web')}
Open ${c.y('http://localhost:9000')} in Chrome → DevTools → device mode (phone). Use a private window for a fresh user.`)
  await rl.question(c.dim('Press Enter when the app is open… '))
  await checklist('Confirm what you see:', [
    'Onboarding → feed loads, header shows 🔥 0 and a profile button',
    'Completing a unit shows "Geschafft! 🎉 +15 XP · 🔥 1 Tag" and the chip shows 🔥 1',
    'The account sheet appears ~1 s later ("Sichere deinen Streak") – in the browser it says sign-in is app-only',
    'After the 2nd unit, swiping shows the "Für heute geschafft!" paywall card',
    'Profile: streak 1, week 2/5, level 1 (25/50 XP), 🌱 unlocked, "Heute 2/2"',
    'Premium page: perks list + "in der App abschließen"',
  ])
}

// ---------------------------------------------------------------- device
async function stepDevice() {
  section('5 · iOS device: Apple sign-in + sandbox purchase')
  console.log(c.dim('Peer dependencies (must allow @capacitor/core 7):'))
  for (const pkg of ['@revenuecat/purchases-capacitor@10', '@capgo/capacitor-social-login@7']) {
    const r = runQuiet('npm', ['view', pkg, 'peerDependencies', '--json'])
    const ok = r.status === 0 && /"\^?7|>=7|7\./.test(r.stdout)
    record(`${pkg} supports Capacitor 7`, ok, r.stdout.replace(/\s+/g, ' ').slice(-120))
  }
  record('native plugins installed', run('pnpm', ['install', '--ignore-workspace'], { cwd: CAP_DIR }))
  if (!existsSync(join(CAP_DIR, 'ios'))) {
    mkdirSync(join(CAP_DIR, 'www'), { recursive: true })
    record('iOS platform added', run('npx', ['cap', 'add', 'ios'], { cwd: CAP_DIR }))
  }

  await checklist('One-time setup (see docs/setup-consoles.md):', [
    'Xcode → Signing & Capabilities: "Sign in with Apple" and "In-App Purchase" added',
    'App Store Connect: subscriptions created (e.g. wizzn_monthly, wizzn_yearly) + a Sandbox tester',
    'RevenueCat: entitlement "premium", offering "default" with both packages, iOS public key (appl_…) copied',
    'RevenueCat webhook → https://<public api>/api/webhooks/revenuecat with Authorization = REVENUECAT_WEBHOOK_AUTH (optional for device test – the app also calls /subscription/refresh)',
    'packages/api/.env: REVENUECAT_SECRET_KEY (sk_…) and APPLE_APP_BUNDLE_ID set; for Google also GOOGLE_CLIENT_IDS (web,ios)',
    'Google only: Info.plist has a URL scheme with the reversed iOS client id',
  ])

  const ip = runQuiet('ipconfig', ['getifaddr', 'en0']).stdout?.trim() || '192.168.x.x'
  const lan = await input('Mac LAN IP', ip)
  const rcKey = await input('RevenueCat iOS public key (appl_…)')
  const gWeb = await input('Google web client id (empty = skip Google)')
  const gIos = gWeb ? await input('Google iOS client id') : ''
  const cmd = `cd packages/web && API_URL=http://${lan}:3000 REVENUECAT_IOS_KEY=${rcKey} GOOGLE_WEB_CLIENT_ID=${gWeb} GOOGLE_IOS_CLIENT_ID=${gIos} pnpm dev:ios`
  console.log(`
1. Make sure packages/api/.env has CORS_ORIGINS incl. capacitor://localhost and run ${c.y('pnpm dev')} (API reachable on http://${lan}:3000).
2. In another terminal run:
   ${c.y(cmd)}
3. Pick your iPhone in Xcode and run. Settings → App Store → Sandbox account: sign in with the tester.`)
  await rl.question(c.dim('Press Enter when the app runs on the device… '))
  await checklist('Confirm on the device:', [
    'As guest: complete a unit → account sheet shows "Mit Apple anmelden" (first) and Google (if configured)',
    'Apple sign-in succeeds; profile shows your e-mail (or private relay) instead of "Gast"',
    'Streak, XP and the 🌱 badge are still there after sign-in (progress moved from the anonymous user)',
    'Premium page lists packages with real prices (bridge to RevenueCat works)',
    'Sandbox purchase completes → "Willkommen bei Premium! ✨" and the feed has no cap',
    'Kill + reopen the app: still signed in and premium',
    '"Käufe wiederherstellen" reports premium (or "Kein aktives Abo" on a fresh tester)',
  ])
}

// ---------------------------------------------------------------- commit
async function stepCommit() {
  section('6 · Commit')
  const failed = results.filter((r) => !r.ok)
  if (failed.length && !(await ask(`${failed.length} check(s) failed. Commit anyway?`))) return
  console.log(runQuiet('git', ['status', '--short']).stdout)
  if (!(await ask(`Commit everything above as "${COMMIT_MSG}"?`))) return
  record('git add', run('git', ['add', '-A', '--', '.', ':!.tmp-m4']))
  record('git commit', run('git', ['commit', '-m', COMMIT_MSG]))
  if (await ask('Push to origin?')) record('git push', run('git', ['push']))
}

// ---------------------------------------------------------------- main
const STEPS = { env: stepEnv, auto: stepAuto, db: stepDb, smoke: stepSmoke, browser: stepBrowser, device: stepDevice, commit: stepCommit }
const which = process.argv[2] ?? 'all'
const order = which === 'all' ? Object.keys(STEPS) : ['env', which]
if (!order.every((s) => STEPS[s])) {
  console.log(`Usage: pnpm verify:m4 [all|${Object.keys(STEPS).join('|')}]`)
  process.exit(1)
}
for (const s of order) {
  if (which === 'all' && s !== 'env' && !(await ask(`Run step "${s}"?`))) continue
  await STEPS[s]()
}

section('Summary')
for (const r of results) console.log(`${r.ok ? c.ok('✓') : c.bad('✗')} ${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(failed ? c.bad(`\n${failed} failed – paste the output to Claude to fix.`) : c.ok('\nAll checks passed – M4 is closed. 🎉'))
rl.close()
process.exit(failed ? 1 : 0)
