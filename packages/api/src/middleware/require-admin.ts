import { createMiddleware } from 'hono/factory'
import type { AppVariables, AuthPort } from '../types.js'

/** Admins = non-anonymous accounts listed in ADMIN_EMAILS (spec §5: single role for 3 devs). */
export const requireAdmin = (auth: AuthPort, adminEmails: string[]) => {
  const allowed = new Set(adminEmails.map((e) => e.toLowerCase()))
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const user = await auth.getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (user.isAnonymous || !allowed.has(user.email.toLowerCase())) return c.json({ error: 'Forbidden' }, 403)
    c.set('user', user)
    await next()
  })
}
