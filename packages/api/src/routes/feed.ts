import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { FEED_PAGE_SIZE, completionInputSchema, isCompletion, orderFeed, type CompletionResult, type FeedResponse } from '@wizzn/shared'
import type { FeedRepo } from '../feed-repo.js'
import { localDate } from '../local-date.js'
import { requireUser } from '../middleware/require-user.js'
import type { AppVariables, AuthPort } from '../types.js'

export const feedRoutes = (auth: AuthPort, repo: FeedRepo, now: () => Date = () => new Date()) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireUser(auth))
    .get('/feed', zValidator('query', z.object({ limit: z.coerce.number().int().min(1).max(20).default(FEED_PAGE_SIZE) })), async (c) => {
      const userId = c.get('user').id
      const prefs = await repo.getPrefs(userId)
      if (!prefs.fieldIds.length) return c.json({ error: 'Onboarding required' }, 409)
      const candidates = await repo.getCandidates(userId, prefs.formats, prefs.themeIds)
      const picked = orderFeed(candidates, prefs.fieldIds, c.req.valid('query').limit)
      const units = await repo.loadUnits(picked.map((p) => p.id))
      const body: FeedResponse = {
        units: picked.flatMap((p) => {
          const u = units.get(p.id)
          return u ? [{ ...u, discovery: p.discovery }] : []
        }),
      }
      await repo.recordImpressions(userId, body.units.map((u) => u.id))
      return c.json(body)
    })
    .post('/units/:id/complete', zValidator('param', z.object({ id: z.string().uuid() })), zValidator('json', completionInputSchema), async (c) => {
      const userId = c.get('user').id
      const content = await repo.getPublishedContent(c.req.valid('param').id)
      if (!content) return c.json({ error: 'Not Found' }, 404)
      const reason = isCompletion(content, c.req.valid('json'))
      if (reason) return c.json({ completed: false, firstTime: false, reason } satisfies CompletionResult, 400)
      const prefs = await repo.getPrefs(userId)
      const firstTime = await repo.insertCompletion(userId, c.req.valid('param').id, localDate(now(), prefs.timezone))
      return c.json({ completed: true, firstTime } satisfies CompletionResult)
    })
