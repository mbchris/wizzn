import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { fieldRoutes } from './routes/fields.js'
import { healthRoutes } from './routes/health.js'
import { meRoutes } from './routes/me.js'
import type { AuthPort, Repos } from './types.js'

export interface AppDeps {
  auth: AuthPort
  repos: Repos
  corsOrigins: string[]
  logRequests?: boolean
}

export function createApp({ auth, repos, corsOrigins, logRequests = false }: AppDeps) {
  const app = new Hono()
  if (logRequests) app.use('*', logger())
  app.use('/api/*', cors({ origin: corsOrigins, credentials: true }))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/health', healthRoutes(repos))
  app.route('/api/fields', fieldRoutes(repos))
  app.route('/api/me', meRoutes(auth, repos))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal Error' }, 500)
  })
  return app
}
