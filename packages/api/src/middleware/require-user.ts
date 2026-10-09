import { createMiddleware } from 'hono/factory'
import type { AppVariables, AuthPort } from '../types.js'

export const requireUser = (auth: AuthPort) =>
  createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    c.set('user', user)
    await next()
  })
