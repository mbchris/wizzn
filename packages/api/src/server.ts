import { serve } from '@hono/node-server'
import { createAdminRepo } from './admin-repo.js'
import { createApp } from './app.js'
import { createFeedRepo } from './feed-repo.js'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { devLanOrigins } from './devOrigins.js'
import { sendUnitJob, startBoss } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { createImageReplacer } from './pipeline/replace-image.js'
import { createDbPipelineStore } from './pipeline/store-db.js'
import { createProviders } from './providers/index.js'
import { createLocalMediaStore } from './providers/media-store.js'
import { createProgressRepo } from './progress-repo.js'
import { createRepos } from './repos.js'
import { createRevenueCatClient } from './revenuecat.js'
import type { AuthPort } from './types.js'

const env = loadEnv()
// Dev: phones/emulators load the app from http://<LAN IP>:9000 → allow it for CORS + Better Auth, whatever the IP is today
if (env.NODE_ENV === 'development') env.CORS_ORIGINS.push(...devLanOrigins())
const { db, pool } = createDb(env.DATABASE_URL)
const progress = createProgressRepo(db)
const auth = createAuth(db, env, {
  async onAnonymousLinked(from, to) {
    const outcome = await progress.transferUserData(from, to)
    console.log(`anonymous ${from} linked to ${to}: ${outcome}`)
  },
})
const boss = await startBoss(env.DATABASE_URL)
const media = createLocalMediaStore(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL)
const providers = createProviders(env)
const images = createImageReplacer({
  store: createDbPipelineStore(db),
  image: { stock: providers.stock, images: providers.images, media: providers.media, llm: providers.llm, minEdgePx: env.STOCK_MIN_EDGE_PX, maxBytes: env.STOCK_MAX_BYTES, log: console.log },
  mediaUrl: media.publicUrl,
})

const authPort: AuthPort = {
  handler: (req) => auth.handler(req),
  async getSessionUser(headers) {
    const s = await auth.api.getSession({ headers })
    if (!s) return null
    return { id: s.user.id, name: s.user.name, email: s.user.email, isAnonymous: Boolean((s.user as { isAnonymous?: boolean }).isAnonymous) }
  },
}

const app = createApp({ auth: authPort, repos: createRepos(db), corsOrigins: env.CORS_ORIGINS,
  feed: createFeedRepo(db, media.publicUrl),
  progress: {
    repo: progress,
    freeDailyCap: env.FREE_DAILY_CAP,
    webhookAuth: env.REVENUECAT_WEBHOOK_AUTH,
    ...(env.REVENUECAT_SECRET_KEY ? { revenueCat: createRevenueCatClient(env.REVENUECAT_SECRET_KEY) } : {}),
  },
  admin: {
    emails: env.ADMIN_EMAILS,
    repo: createAdminRepo(db, media.publicUrl),
    queue: {
      enqueueResearch: async (id) => void (await sendUnitJob(boss, QUEUES.research, id)),
      enqueue: async (queue, id) => void (await sendUnitJob(boss, queue, id)),
    },
    images,
  },
  logRequests: env.NODE_ENV !== 'test' })
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`wizzn api on :${info.port}`))

const shutdown = (): void => {
  server.close()
  void boss.stop({ graceful: true }).then(() => pool.end()).then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
