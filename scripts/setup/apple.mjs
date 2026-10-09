#!/usr/bin/env node
// Creates/configures the Apple Developer + App Store Connect resources for wizzn. Idempotent.
//   Bundle ID · capabilities (Push, Sign in with Apple, IAP) · checks the App Store Connect app record
// Auth: App Store Connect API key (Admin role). Usage: pnpm setup:apple
import { info, ok, warn, need, manual, printManual } from './lib.mjs'
import { ascClient } from './asc.mjs'

need('APP_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH')
const APP_ID = process.env.APP_ID
const NAME = process.env.APP_NAME || 'wizzn'
const api = ascClient({ keyPath: process.env.ASC_KEY_PATH, keyId: process.env.ASC_KEY_ID, issuerId: process.env.ASC_ISSUER_ID })

// 1. Bundle ID
info(`Bundle ID ${APP_ID}`)
let bundle = (await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(APP_ID)}`)).data
  .find((b) => b.attributes.identifier === APP_ID)
if (!bundle) {
  bundle = (await api('POST', '/v1/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: APP_ID, name: NAME, platform: 'IOS' } },
  })).data
  ok('bundle ID created')
} else ok('bundle ID exists')

// 2. Capabilities
const have = new Set((await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data
  .map((c) => c.attributes.capabilityType))
const wanted = [
  { capabilityType: 'PUSH_NOTIFICATIONS' },
  { capabilityType: 'IN_APP_PURCHASE' },
  { capabilityType: 'SIGN_IN_WITH_APPLE',
    settings: [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }] },
]
for (const cap of wanted) {
  if (have.has(cap.capabilityType)) { ok(`${cap.capabilityType} already on`); continue }
  await api('POST', '/v1/bundleIdCapabilities', {
    data: { type: 'bundleIdCapabilities', attributes: cap,
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } } },
  })
  ok(`${cap.capabilityType} enabled`)
}

// 3. App Store Connect app record (API can read, not create)
info('App Store Connect app record')
const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(APP_ID)}`)).data[0]
if (app) ok(`app exists: "${app.attributes.name}" (Apple ID ${app.id}) → set APP_STORE_ID=${app.id} in .env`)
else {
  warn('no app record yet')
  manual(`Create the app in App Store Connect → Apps → + → New App (platform iOS, bundle ID ${APP_ID}, SKU e.g. wizzn-ios, primary language German): https://appstoreconnect.apple.com/apps`)
}

// Steps Apple offers no API for
const keys = 'https://developer.apple.com/account/resources/authkeys/list'
if (!process.env.APNS_KEY_ID) manual(`Create a Key with "Apple Push Notifications service (APNs)" → download .p8 (once!) → save as APNS_KEY_PATH, set APNS_KEY_ID (API/worker sends iOS push directly to APNs): ${keys}`)
if (!process.env.APPLE_SIWA_KEY_ID) manual(`Create a Key with "Sign in with Apple" (primary App ID ${APP_ID}) → save .p8 as APPLE_SIWA_KEY_PATH, set APPLE_SIWA_KEY_ID: ${keys}`)
if (!process.env.APPLE_SERVICES_ID) manual(`Optional (Apple sign-in on Android/web): create a Services ID (e.g. ${APP_ID}.signin), enable Sign in with Apple, domain = API host, return URL <BETTER_AUTH_URL>/api/auth/callback/apple: https://developer.apple.com/account/resources/identifiers/list/serviceId`)
manual('Then run `pnpm setup:apple:secret` to generate APPLE_CLIENT_SECRET for Better Auth')
printManual('Apple')
