import { Hono } from 'hono'
import type { FeedRepo } from '../feed-repo.js'
import { localDate } from '../local-date.js'
import { requireUser } from '../middleware/require-user.js'
import type { ProgressRepo } from '../progress-repo.js'
import type { RevenueCatClient } from '../revenuecat.js'
import type { AppVariables, AuthPort } from '../types.js'

export interface ProgressRouteDeps {
  progress: ProgressRepo
  feed: FeedRepo
  freeDailyCap: number
  revenueCat?: RevenueCatClient
  now?: () => Date
}

export const progressRoutes = (auth: AuthPort, { progress, feed, freeDailyCap, revenueCat, now = () => new Date() }: ProgressRouteDeps) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireUser(auth))
    .get('/progress', async (c) => {
      const userId = c.get('user').id
      const at = now()
      const { timezone } = await feed.getPrefs(userId)
      return c.json(await progress.getProgress(userId, localDate(at, timezone), await progress.getPremium(userId, at), freeDailyCap))
    })
    // Called by the app right after a purchase/restore: the webhook may arrive seconds later
    .post('/subscription/refresh', async (c) => {
      const user = c.get('user')
      if (!revenueCat) return c.json({ error: 'Subscriptions not configured' }, 503)
      const premium = await revenueCat.fetchPremium(user.id)
      if (premium) await progress.setEntitlement(user.id, premium.productId, premium.activeUntil)
      return c.json(await progress.getPremium(user.id, now()))
    })
