#!/usr/bin/env node
// Creates/configures the Google Cloud + Firebase resources for wizzn. Idempotent: safe to re-run.
//   GCP project · billing link (optional) · APIs · Firebase · Android app · SHA fingerprints · FCM sender SA
//   → setup-out/google-services.json. Firebase = Android push only; iOS push goes to APNs directly.
// Auth: your gcloud login (`gcloud auth login`). Usage: pnpm setup:google
import { execFileSync } from 'node:child_process'
import { info, ok, warn, need, manual, printManual, writeOut, sleep, upsertEnv } from './lib.mjs'

need('GCP_PROJECT_ID', 'APP_ID')
const PROJECT = process.env.GCP_PROJECT_ID
const APP_ID = process.env.APP_ID
const NAME = process.env.APP_NAME || 'wizzn'
const SHAS = (process.env.ANDROID_SHA1 || '').split(',').map((s) => s.trim()).filter(Boolean)
const SHA256S = (process.env.ANDROID_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean)

const gcloud = (args, opts = {}) =>
  execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'] }).trim()

try { gcloud(['--version'], { quiet: true }) } catch {
  console.error('gcloud not found. Install: https://cloud.google.com/sdk/docs/install'); process.exit(1)
}
const token = gcloud(['auth', 'print-access-token'])

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) { const e = new Error(`${method} ${url} → ${res.status}: ${json.error?.message || text}`); e.status = res.status; throw e }
  return json
}
async function waitOp(op) {
  if (!op.name || op.done) return op
  for (let i = 0; i < 60; i++) {
    const o = await api('GET', `https://firebase.googleapis.com/v1beta1/${op.name}`)
    if (o.done) { if (o.error) throw new Error(o.error.message); return o }
    await sleep(2000)
  }
  throw new Error(`timeout waiting for ${op.name}`)
}
const FB = `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`

// 1. Project
info(`GCP project ${PROJECT}`)
let exists = true
try { gcloud(['projects', 'describe', PROJECT, '--format=value(projectId)'], { quiet: true }) } catch { exists = false }
if (!exists) {
  const args = ['projects', 'create', PROJECT, `--name=${NAME}`]
  if (process.env.GCP_ORG_ID) args.push(`--organization=${process.env.GCP_ORG_ID}`)
  gcloud(args); ok('project created')
} else ok('project exists')

if (process.env.GCP_BILLING_ACCOUNT) {
  gcloud(['billing', 'projects', 'link', PROJECT, `--billing-account=${process.env.GCP_BILLING_ACCOUNT}`], { quiet: true })
  ok('billing linked')
}

// 2. APIs
info('Enabling APIs')
gcloud(['services', 'enable', '--project', PROJECT,
  'firebase.googleapis.com', 'fcm.googleapis.com', 'firebaseinstallations.googleapis.com',
  'iamcredentials.googleapis.com', 'people.googleapis.com'])
ok('APIs enabled')

// 3. Firebase
info('Firebase')
try { await api('GET', FB); ok('Firebase already enabled') } catch (e) {
  if (e.status !== 404 && e.status !== 403) throw e
  await waitOp(await api('POST', `${FB}:addFirebase`, {})); ok('Firebase added')
}

// 4. Android app
info(`Android app ${APP_ID}`)
let android = (await api('GET', `${FB}/androidApps`)).apps?.find((a) => a.packageName === APP_ID)
if (!android) {
  const op = await waitOp(await api('POST', `${FB}/androidApps`, { packageName: APP_ID, displayName: NAME }))
  android = op.response; ok('Android app created')
} else ok('Android app exists')
const existingShas = ((await api('GET', `${FB}/androidApps/${android.appId}/sha`)).certificates || [])
  .map((c) => c.shaHash.toLowerCase())
for (const [list, type] of [[SHAS, 'SHA_1'], [SHA256S, 'SHA_256']]) {
  for (const raw of list) {
    const sha = raw.replace(/:/g, '').toLowerCase()
    if (existingShas.includes(sha)) continue
    await api('POST', `${FB}/androidApps/${android.appId}/sha`, { shaHash: sha, certType: type }); ok(`added ${type} ${raw}`)
  }
}
if (!SHAS.length) warn('ANDROID_SHA1 empty → Google sign-in on Android will fail until you add one and re-run')

// 6. Config files
const andCfg = await api('GET', `${FB}/androidApps/${android.appId}/config`)
writeOut('google-services.json', Buffer.from(andCfg.configFileContents, 'base64'))

// 7. Read OAuth client IDs out of the configs (exist once the consent screen + clients are set up)
const gs = JSON.parse(Buffer.from(andCfg.configFileContents, 'base64').toString())
const clients = gs.client?.[0]?.oauth_client || []
const webClient = clients.find((c) => c.client_type === 3)?.client_id
upsertEnv({
  GOOGLE_WEB_CLIENT_ID: webClient,
  // web client first (server + Android), iOS client appended by hand later
  GOOGLE_CLIENT_IDS: webClient && !(process.env.GOOGLE_CLIENT_IDS || '').includes(webClient)
    ? [webClient, ...(process.env.GOOGLE_CLIENT_IDS || '').split(',').filter(Boolean)].join(',') : undefined,
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_SERVICE_ACCOUNT_JSON: 'setup-out/fcm-sender.json',
})

// 8. Service account for the API/worker to send FCM pushes
info('FCM sender service account')
const SA = `fcm-sender@${PROJECT}.iam.gserviceaccount.com`
try { gcloud(['iam', 'service-accounts', 'describe', SA, '--project', PROJECT], { quiet: true }); ok('service account exists') } catch {
  gcloud(['iam', 'service-accounts', 'create', 'fcm-sender', '--project', PROJECT, '--display-name=wizzn FCM sender']); ok('service account created')
}
gcloud(['projects', 'add-iam-policy-binding', PROJECT, `--member=serviceAccount:${SA}`,
  '--role=roles/firebasecloudmessaging.admin', '--condition=None', '--quiet'], { quiet: true })
ok('role firebasecloudmessaging.admin granted')
if (process.argv.includes('--create-key')) {
  gcloud(['iam', 'service-accounts', 'keys', 'create', 'setup-out/fcm-sender.json', `--iam-account=${SA}`, '--project', PROJECT])
  ok('key written to setup-out/fcm-sender.json')
} else warn('No SA key created (re-run with --create-key once; keys are secrets, don’t create many)')

// Manual steps Google offers no API for
const c = `https://console.cloud.google.com`
if (!webClient) {
  manual(`OAuth consent screen (External, app name "${NAME}", support email, scopes email/profile/openid): ${c}/auth/branding?project=${PROJECT}`)
  manual(`Create OAuth client "Web application" → GOOGLE_CLIENT_SECRET in .env (used by Better Auth server to verify ID tokens). Add redirect URI <BETTER_AUTH_URL>/api/auth/callback/google: ${c}/auth/clients/create?project=${PROJECT}`)
  manual('Re-run `pnpm setup:google` so the configs include the web client id')
}
manual(`Create OAuth client "iOS" with bundle id ${APP_ID} (Google sign-in on iOS, no Firebase needed) → set GOOGLE_IOS_CLIENT_ID and append to GOOGLE_CLIENT_IDS in .env; reversed id = URL scheme in Info.plist: ${c}/auth/clients/create?project=${PROJECT}`)
manual('After `npx cap add android`: copy setup-out/google-services.json → packages/web/src-capacitor/android/app/')
printManual('Google')
