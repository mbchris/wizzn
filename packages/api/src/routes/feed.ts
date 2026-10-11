import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { FEED_PAGE_SIZE, buildAffinity, completionInputSchema, dailyCap, isCompletion, orderFeed, rankCandidates, type CompletionResult, type FeedResponse } from '@wizzn/shared'
import type { FeedRepo } from '../feed-repo.js'
import { localDate } from '../local-date.js'
import { requireUser } from '../middleware/require-user.js'
import type { ProgressRepo } from '../progress-repo.js'
import type { AppVariables, AuthPort } from '../types.js'

export const feedRoutes = (auth: AuthPort, repo: FeedRepo, progress: ProgressRepo, freeDailyCap: number, now: () => Date = () => new Date()) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireUser(auth))
    .get('/feed', zValidator('query', z.object({ limit: z.coerce.number().int().min(1).max(20).default(FEED_PAGE_SIZE) })), async (c) => {
      const userId = c.get('user').id
      const prefs = await repo.getPrefs(userId)
      if (!prefs.fieldIds.length) return c.json({ error: 'Onboarding required' }, 409)
      const at = now()
      const premium = await progress.getPremium(userId, at)
      const cap = dailyCap(await progress.countDoneOn(userId, localDate(at, prefs.timezone)), premium.active, freeDailyCap)
      // Spec §6.4: free users get the paywall after the cap; no units are served (or marked as seen) until tomorrow
      if (cap.reached) return c.json({ units: [], cap } satisfies FeedResponse)
      const [candidates, signals] = await Promise.all([repo.getCandidates(userId, prefs.themeIds, prefs.formats), repo.getSignals(userId)])
      // Knowledge stream: level gating + more/less affinity before the round-robin
      const ranked = rankCandidates(candidates, buildAffinity(signals, at), prefs.themeIds)
      const picked = orderFeed(ranked, prefs.fieldIds, c.req.valid('query').limit)
      const units = await repo.loadUnits(picked.map((p) => p.id), userId)
      const body: FeedResponse = {
        units: picked.flatMap((p) => {
          const u = units.get(p.id)
          return u ? [{ ...u, discovery: p.discovery }] : []
        }),
        cap,
      }
      await repo.recordImpressions(userId, body.units.map((u) => u.id))
      return c.json(body)
    })
    .post('/units/:id/complete', zValidator('param', z.object({ id: z.string().uuid() })), zValidator('json', completionInputSchema), async (c) => {
      const userId = c.get('user').id
      const unitId = c.req.valid('param').id
      const content = await repo.getPublishedContent(unitId)
      if (!content) return c.json({ error: 'Not Found' }, 404)
      const reason = isCompletion(content, c.req.valid('json'))
      if (reason) return c.json({ completed: false, firstTime: false, reason } satisfies CompletionResult, 400)
      const prefs = await repo.getPrefs(userId)
      const at = now()
      const today = localDate(at, prefs.timezone)
      const premium = await progress.getPremium(userId, at)
      if (dailyCap(await progress.countDoneOn(userId, today), premium.active, freeDailyCap).reached) {
        return c.json({ completed: false, firstTime: false, reason: 'daily_cap' } satisfies CompletionResult, 402)
      }
      const rewards = await progress.recordCompletion(userId, unitId, today, premium.active, freeDailyCap)
      return c.json((rewards ? { completed: true, firstTime: true, rewards } : { completed: true, firstTime: false }) satisfies CompletionResult)
    })
