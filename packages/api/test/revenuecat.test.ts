import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { entitlementAction, entitlementFromSubscriber, type RevenueCatWebhook } from '../src/revenuecat.js'
import { fakeAuth, fakeProgress, fakeRepos } from './fakes.js'

const NOW = new Date('2026-10-09T12:00:00Z')
const EXP = Date.parse('2026-11-09T12:00:00Z')
const ev = (e: Partial<RevenueCatWebhook['event']>): RevenueCatWebhook => ({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'wizzn_monthly', entitlement_ids: ['premium'], expiration_at_ms: EXP, ...e } })

describe('entitlementAction', () => {
  it('sets premium until the expiration on purchase, renewal and cancellation', () => {
    for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'EXPIRATION']) {
      expect(entitlementAction(ev({ type }), NOW)).toEqual({ kind: 'set', userId: 'user-1', productId: 'wizzn_monthly', activeUntil: new Date(EXP) })
    }
  })
  it('uses the new product on product changes', () => {
    expect(entitlementAction(ev({ type: 'PRODUCT_CHANGE', new_product_id: 'wizzn_yearly' }), NOW)).toMatchObject({ productId: 'wizzn_yearly' })
  })
  it('treats purchases without expiration as lifetime', () => {
    const a = entitlementAction(ev({ type: 'NON_RENEWING_PURCHASE', expiration_at_ms: null }), NOW)
    expect(a.kind === 'set' && a.activeUntil.getUTCFullYear() > 2100).toBe(true)
  })
  it('resolves our user id from aliases when the app user is anonymous', () => {
    expect(entitlementAction(ev({ app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', 'user-2'] }), NOW)).toMatchObject({ userId: 'user-2' })
    expect(entitlementAction(ev({ app_user_id: '$RCAnonymousID:abc', aliases: [] }), NOW).kind).toBe('ignore')
  })
  it('ignores other entitlements and informational events', () => {
    expect(entitlementAction(ev({ entitlement_ids: ['other'] }), NOW).kind).toBe('ignore')
    expect(entitlementAction(ev({ type: 'TEST' }), NOW).kind).toBe('ignore')
  })
  it('maps transfers', () => {
    expect(entitlementAction(ev({ type: 'TRANSFER', transferred_from: ['old', '$RCAnonymousID:x'], transferred_to: ['new'] }), NOW)).toEqual({ kind: 'transfer', from: ['old'], to: 'new' })
  })
})

describe('entitlementFromSubscriber', () => {
  it('reads the premium entitlement', () => {
    const json = { subscriber: { entitlements: { premium: { expires_date: '2026-11-09T12:00:00Z', product_identifier: 'wizzn_monthly' } } } }
    expect(entitlementFromSubscriber(json, NOW)).toEqual({ productId: 'wizzn_monthly', activeUntil: new Date(EXP) })
  })
  it('returns null without the entitlement', () => {
    expect(entitlementFromSubscriber({ subscriber: { entitlements: {} } }, NOW)).toBeNull()
    expect(entitlementFromSubscriber({ nope: 1 }, NOW)).toBeNull()
  })
})

describe('POST /api/webhooks/revenuecat', () => {
  const setup = (webhookAuth = 'Bearer whsec') => {
    const progress = fakeProgress({ knownUsers: ['user-1'] })
    const app = createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [], progress: { repo: progress, freeDailyCap: 3, webhookAuth } })
    const post = (body: unknown, authorization?: string) =>
      app.request('/api/webhooks/revenuecat', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) })
    return { progress, post }
  }
  it('rejects a wrong secret', async () => {
    expect((await setup().post(ev({}), 'Bearer nope')).status).toBe(401)
    expect((await setup().post(ev({}))).status).toBe(401)
  })
  it('is disabled without a configured secret', async () => {
    expect((await setup('').post(ev({}), '')).status).toBe(503)
  })
  it('stores the entitlement', async () => {
    const s = setup()
    const res = await s.post(ev({}), 'Bearer whsec')
    expect(await res.json()).toEqual({ ok: true, applied: true })
    expect(s.progress.entitlements.get('user-1')).toEqual({ productId: 'wizzn_monthly', activeUntil: new Date(EXP) })
  })
  it('acknowledges unknown users so RevenueCat stops retrying', async () => {
    const res = await setup().post(ev({ app_user_id: 'ghost' }), 'Bearer whsec')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, applied: false })
  })
  it('applies transfers', async () => {
    const s = setup()
    await s.post(ev({ type: 'TRANSFER', transferred_from: ['a'], transferred_to: ['user-1'] }), 'Bearer whsec')
    expect(s.progress.transfers).toEqual([{ from: 'a', to: 'user-1' }])
  })
})
