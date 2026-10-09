/** The web package has no @capacitor/* dependency: native plugins are reached through the bridge the runtime injects. */
export function isNative(): boolean {
  return window.Capacitor?.isNativePlatform() === true
}

export function platform(): 'ios' | 'android' | 'web' {
  return window.Capacitor?.getPlatform() ?? 'web'
}

/** Returns the native plugin proxy, or null in the browser / when the plugin is not installed */
export function nativePlugin<T>(name: string): T | null {
  if (!isNative()) return null
  return (window.Capacitor?.Plugins[name] as T | undefined) ?? null
}
