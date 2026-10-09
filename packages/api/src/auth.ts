import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
import type { Db } from './db/client.js'
import type { Env } from './env.js'
import { account, session, user, verification } from './db/schema/index.js'

export function createAuth(db: Db, env: Env) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.CORS_ORIGINS,
    emailAndPassword: { enabled: true },
    // Spec §2: try first, account later. Apple/Google providers are added in M4.
    plugins: [anonymous()],
  })
}
