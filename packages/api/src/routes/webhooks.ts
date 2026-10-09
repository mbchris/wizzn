import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { ProgressRepo } from '../progress-repo.js'
import { entitlementAction, revenueCatWebhookSchema } from '../revenuecat.js'

const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** RevenueCat sends the Authorization header value configured in its dashboard verbatim. */
export const webhookRoutes = (webhookAuth: string, progress: ProgressRepo, now: () => Date = () => new Date()) =>
  new Hono().post(
    '/revenuecat',
    async (c, next) => {
      if (!webhookAuth) return c.json({ error: 'Webhook not configured' }, 503)
      if (!sameSecret(c.req.header('authorization') ?? '', webhookAuth)) return c.json({ error: 'Unauthorized' }, 401)
      await next()
    },
    zValidator('json', revenueCatWebhookSchema),
    async (c) => {
      const action = entitlementAction(c.req.valid('json'), now())
      if (action.kind === 'set') {
        const known = await progress.setEntitlement(action.userId, action.productId, action.activeUntil)
        // 200 even for unknown users: RevenueCat retries non-2xx responses, which would never succeed
        return c.json({ ok: true, applied: known })
      }
      if (action.kind === 'transfer') {
        await progress.transferEntitlement(action.from, action.to)
        return c.json({ ok: true, applied: true })
      }
      return c.json({ ok: true, applied: false, reason: action.reason })
    },
  )
