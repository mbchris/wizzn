import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { createRepos } from './repos.js'
import type { AuthPort } from './types.js'

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const auth = createAuth(db, env)

const authPort: AuthPort = {
  handler: (req) => auth.handler(req),
  async getSessionUser(headers) {
    const s = await auth.api.getSession({ headers })
    if (!s) return null
    return { id: s.user.id, name: s.user.name, isAnonymous: Boolean((s.user as { isAnonymous?: boolean }).isAnonymous) }
  },
}

const app = createApp({ auth: authPort, repos: createRepos(db), corsOrigins: env.CORS_ORIGINS, logRequests: env.NODE_ENV !== 'test' })
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`wizzn api on :${info.port}`))

const shutdown = (): void => {
  server.close()
  void pool.end().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
