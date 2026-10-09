import { z } from 'zod'

/** RevenueCat entitlement identifier that unlocks premium (configure the same id in the RevenueCat dashboard) */
export const PREMIUM_ENTITLEMENT_ID = 'premium'
/** Lifetime / non-expiring purchases have no expiration; treat them as active for 100 years */
const LIFETIME_MS = 100 * 365 * 86_400_000
const ANON_PREFIX = '$RCAnonymousID:'

const ACCESS_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  // Cancelled/billing-issue subscriptions stay active until expiration_at_ms
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
])

export const revenueCatWebhookSchema = z.object({
  event: z
    .object({
      type: z.string(),
      app_user_id: z.string().optional(),
      original_app_user_id: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      product_id: z.string().optional(),
      new_product_id: z.string().optional(),
      entitlement_ids: z.array(z.string()).nullish(),
      expiration_at_ms: z.number().nullish(),
      transferred_from: z.array(z.string()).optional(),
      transferred_to: z.array(z.string()).optional(),
    })
    .passthrough(),
})
export type RevenueCatWebhook = z.infer<typeof revenueCatWebhookSchema>

export type EntitlementAction =
  | { kind: 'set'; userId: string; productId: string; activeUntil: Date }
  | { kind: 'transfer'; from: string[]; to: string }
  | { kind: 'ignore'; reason: string }

const isOurId = (id: string | undefined): id is string => Boolean(id && !id.startsWith(ANON_PREFIX))

/** The app logs in to RevenueCat with our user id, so a non-anonymous RevenueCat id is our user id. */
function ourUserId(e: RevenueCatWebhook['event']): string | undefined {
  return [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].find(isOurId)
}

export function entitlementAction(body: RevenueCatWebhook, now: Date): EntitlementAction {
  const e = body.event
  if (e.type === 'TRANSFER') {
    const to = (e.transferred_to ?? []).find(isOurId)
    const from = (e.transferred_from ?? []).filter(isOurId)
    return to && from.length ? { kind: 'transfer', from, to } : { kind: 'ignore', reason: 'transfer without app user ids' }
  }
  if (!ACCESS_EVENTS.has(e.type)) return { kind: 'ignore', reason: `event ${e.type}` }
  if (e.entitlement_ids && !e.entitlement_ids.includes(PREMIUM_ENTITLEMENT_ID)) return { kind: 'ignore', reason: 'other entitlement' }
  const userId = ourUserId(e)
  if (!userId) return { kind: 'ignore', reason: 'anonymous RevenueCat user' }
  const productId = e.new_product_id ?? e.product_id ?? 'unknown'
  const activeUntil = new Date(e.expiration_at_ms ?? now.getTime() + LIFETIME_MS)
  return { kind: 'set', userId, productId, activeUntil }
}

const subscriberSchema = z.object({
  subscriber: z.object({
    entitlements: z.record(z.object({ expires_date: z.string().nullable(), product_identifier: z.string() })).default({}),
  }),
})

/** GET /v1/subscribers/:id → premium entitlement, or null when the user never had it */
export function entitlementFromSubscriber(json: unknown, now: Date): { productId: string; activeUntil: Date } | null {
  const parsed = subscriberSchema.safeParse(json)
  const ent = parsed.success ? parsed.data.subscriber.entitlements[PREMIUM_ENTITLEMENT_ID] : undefined
  if (!ent) return null
  return { productId: ent.product_identifier, activeUntil: ent.expires_date ? new Date(ent.expires_date) : new Date(now.getTime() + LIFETIME_MS) }
}

export interface RevenueCatClient {
  /** null when RevenueCat does not know the user or has no premium entitlement */
  fetchPremium(userId: string): Promise<{ productId: string; activeUntil: Date } | null>
}

export function createRevenueCatClient(secretKey: string, fetchFn: typeof fetch = fetch): RevenueCatClient {
  return {
    async fetchPremium(userId) {
      const res = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
        headers: { authorization: `Bearer ${secretKey}`, accept: 'application/json' },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`RevenueCat ${res.status}: ${await res.text()}`)
      return entitlementFromSubscriber(await res.json(), new Date())
    },
  }
}
