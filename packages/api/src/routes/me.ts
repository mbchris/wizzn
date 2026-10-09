import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { interestsInputSchema } from '@wizzn/shared'
import { requireUser } from '../middleware/require-user.js'
import type { AppVariables, AuthPort, Repos } from '../types.js'

export const meRoutes = (auth: AuthPort, repos: Repos) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireUser(auth))
    .get('/', async (c) => c.json(await repos.getMe(c.get('user'))))
    .put('/interests', zValidator('json', interestsInputSchema), async (c) => {
      await repos.saveInterests(c.get('user').id, c.req.valid('json'))
      return c.json(await repos.getMe(c.get('user')))
    })
