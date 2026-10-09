import { serve } from '@hono/node-server'
import { createAdminRepo } from './admin-repo.js'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { sendUnitJob, startBoss } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { createLocalMediaStore } from './providers/media-store.js'
import { createRepos } from './repos.js'
import type { AuthPort } from './types.js'

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const auth = createAuth(db, env)
const boss = await startBoss(env.DATABASE_URL)
const media = createLocalMediaStore(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL)

const authPort: AuthPort = {
  handler: (req) => auth.handler(req),
  async getSessionUser(headers) {
    const s = await auth.api.getSession({ headers })
    if (!s) return null
    return { id: s.user.id, name: s.user.name, email: s.user.email, isAnonymous: Boolean((s.user as { isAnonymous?: boolean }).isAnonymous) }
  },
}

const app = createApp({ auth: authPort, repos: createRepos(db), corsOrigins: env.CORS_ORIGINS,
  admin: {
    emails: env.ADMIN_EMAILS,
    repo: createAdminRepo(db, media.publicUrl),
    queue: { enqueueResearch: async (id) => void (await sendUnitJob(boss, QUEUES.research, id)) },
  },
  logRequests: env.NODE_ENV !== 'test' })
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`wizzn api on :${info.port}`))

const shutdown = (): void => {
  server.close()
  void boss.stop({ graceful: true }).then(() => pool.end()).then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
