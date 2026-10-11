import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { adminRoutes } from './routes/admin.js'
import { feedRoutes } from './routes/feed.js'
import { fieldRoutes } from './routes/fields.js'
import type { FeedRepo } from './feed-repo.js'
import { healthRoutes } from './routes/health.js'
import { knowledgeRoutes } from './routes/knowledge.js'
import type { KnowledgeRepo } from './knowledge-repo.js'
import { meRoutes } from './routes/me.js'
import { progressRoutes } from './routes/progress.js'
import { webhookRoutes } from './routes/webhooks.js'
import type { ProgressRepo } from './progress-repo.js'
import type { RevenueCatClient } from './revenuecat.js'
import type { ImageReplacer } from './pipeline/replace-image.js'
import type { AdminRepo, AuthPort, JobQueue, Repos } from './types.js'

export interface AppDeps {
  auth: AuthPort
  repos: Repos
  corsOrigins: string[]
  admin?: { emails: string[]; repo: AdminRepo; queue: JobQueue; images?: ImageReplacer }
  feed?: FeedRepo
  knowledge?: KnowledgeRepo
  progress?: { repo: ProgressRepo; freeDailyCap: number; revenueCat?: RevenueCatClient; webhookAuth?: string }
  logRequests?: boolean
}

export function createApp({ auth, repos, corsOrigins, admin, feed, knowledge, progress, logRequests = false }: AppDeps) {
  const app = new Hono()
  if (logRequests) app.use('*', logger())
  app.use('/api/*', cors({ origin: corsOrigins, credentials: true }))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/health', healthRoutes(repos))
  app.route('/api/fields', fieldRoutes(repos))
  app.route('/api/me', meRoutes(auth, repos))
  if (progress) {
    // Registered before the user-authenticated routers mounted at /api: their middleware would otherwise run first
    app.route('/api/webhooks', webhookRoutes(progress.webhookAuth ?? '', progress.repo))
  }
  if (feed && progress) {
    app.route('/api/me', progressRoutes(auth, { progress: progress.repo, feed, freeDailyCap: progress.freeDailyCap, ...(progress.revenueCat ? { revenueCat: progress.revenueCat } : {}) }))
    app.route('/api', feedRoutes(auth, feed, progress.repo, progress.freeDailyCap))
  }
  if (feed && knowledge) app.route('/api', knowledgeRoutes(auth, feed, knowledge, repos))
  if (admin) app.route('/api/admin', adminRoutes(auth, admin.emails, admin.repo, admin.queue, admin.images))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal Error' }, 500)
  })
  return app
}
