import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous, bearer } from 'better-auth/plugins'
import type { Db } from './db/client.js'
import type { Env } from './env.js'
import { account, session, user, verification } from './db/schema/index.js'

export interface AuthHooks {
  /** An anonymous user signed in with Apple/Google/email: carry their progress over */
  onAnonymousLinked(anonymousUserId: string, newUserId: string): Promise<void>
}

function socialProviders(env: Env) {
  const [googleWebClientId] = env.GOOGLE_CLIENT_IDS
  return {
    // Native apps send the provider's id token to POST /api/auth/sign-in/social ({ provider, idToken })
    ...(env.APPLE_APP_BUNDLE_ID
      ? {
          apple: {
            clientId: env.APPLE_CLIENT_ID || env.APPLE_APP_BUNDLE_ID,
            clientSecret: env.APPLE_CLIENT_SECRET,
            appBundleIdentifier: env.APPLE_APP_BUNDLE_ID,
            audience: [env.APPLE_APP_BUNDLE_ID, ...(env.APPLE_CLIENT_ID ? [env.APPLE_CLIENT_ID] : [])],
          },
        }
      : {}),
    // iOS id tokens carry the iOS client id as audience, Android/web ones the web client id: accept all
    ...(googleWebClientId ? { google: { clientId: env.GOOGLE_CLIENT_IDS, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
  }
}

export function createAuth(db: Db, env: Env, hooks: AuthHooks) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [...env.CORS_ORIGINS, 'https://appleid.apple.com'],
    emailAndPassword: { enabled: true },
    socialProviders: socialProviders(env),
    // Spec §2: try first, account later. bearer: the Capacitor app sends `Authorization: Bearer <token>`.
    // The anonymous user is deleted after linking (plugin default), so its rows must be moved first.
    plugins: [
      anonymous({ onLinkAccount: async ({ anonymousUser, newUser }) => hooks.onAnonymousLinked(anonymousUser.user.id, newUser.user.id) }),
      bearer(),
    ],
  })
}
