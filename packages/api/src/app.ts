import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { adminRoutes } from './routes/admin.js'
import { fieldRoutes } from './routes/fields.js'
import { healthRoutes } from './routes/health.js'
import { meRoutes } from './routes/me.js'
import type { AdminRepo, AuthPort, JobQueue, Repos } from './types.js'

export interface AppDeps {
  auth: AuthPort
  repos: Repos
  corsOrigins: string[]
  admin?: { emails: string[]; repo: AdminRepo; queue: JobQueue }
  logRequests?: boolean
}

export function createApp({ auth, repos, corsOrigins, admin, logRequests = false }: AppDeps) {
  const app = new Hono()
  if (logRequests) app.use('*', logger())
  app.use('/api/*', cors({ origin: corsOrigins, credentials: true }))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/health', healthRoutes(repos))
  app.route('/api/fields', fieldRoutes(repos))
  app.route('/api/me', meRoutes(auth, repos))
  if (admin) app.route('/api/admin', adminRoutes(auth, admin.emails, admin.repo, admin.queue))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal Error' }, 500)
  })
  return app
}
