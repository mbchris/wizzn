import type { SocialProvider } from 'src/api'
import { nativePlugin, platform } from './capacitor'

// Subset of @capgo/capacitor-social-login (installed in src-capacitor)
interface SocialLoginPlugin {
  initialize(o: { apple?: Record<string, never>; google?: { webClientId?: string; iOSClientId?: string; iOSServerClientId?: string; mode?: 'online' } }): Promise<void>
  login(o: { provider: SocialProvider; options: { scopes?: string[] } }): Promise<{ provider: SocialProvider; result: { idToken?: string | null } }>
}

let initialized = false

function plugin(): SocialLoginPlugin | null {
  return nativePlugin<SocialLoginPlugin>('SocialLogin')
}

/** Spec §9: Apple sign-in is offered on iOS (mandatory there once Google is offered) */
export function availableProviders(): SocialProvider[] {
  if (!plugin()) return []
  const google = process.env.GOOGLE_WEB_CLIENT_ID ? (['google'] as const) : []
  return platform() === 'ios' ? ['apple', ...google] : [...google]
}

/** Opens the native sheet; resolves null when the user cancelled */
export async function getIdToken(provider: SocialProvider): Promise<string | null> {
  const p = plugin()
  if (!p) throw new Error('Anmeldung ist nur in der App verfügbar.')
  if (!initialized) {
    await p.initialize({
      ...(platform() === 'ios' ? { apple: {} } : {}),
      ...(process.env.GOOGLE_WEB_CLIENT_ID
        ? { google: { webClientId: process.env.GOOGLE_WEB_CLIENT_ID, iOSClientId: process.env.GOOGLE_IOS_CLIENT_ID, iOSServerClientId: process.env.GOOGLE_WEB_CLIENT_ID, mode: 'online' } }
        : {}),
    })
    initialized = true
  }
  try {
    const res = await p.login({ provider, options: { scopes: provider === 'apple' ? ['email', 'name'] : ['email', 'profile'] } })
    return res.result.idToken ?? null
  } catch (e) {
    if (/cancel/i.test(String((e as { message?: string }).message ?? e))) return null
    throw e
  }
}
